"""
This module contains all document-related routes for the LightRAG API.
"""

import asyncio
import re
import shutil
import time
from uuid import uuid4
from functools import lru_cache
from lightrag.utils import (
    logger,
    get_pinyin_sort_key,
    performance_timing_log,
    validate_workspace,
)
import aiofiles
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any, Literal
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from lightrag import LightRAG
from lightrag.base import DocProcessingStatus, DocStatus
from lightrag.utils import (
    generate_track_id,
    compute_mdhash_id,
    sanitize_text_for_encoding,
    move_file_to_parsed_dir,
)
from lightrag.api.utils_api import get_combined_auth_dependency
from lightrag.api.workspace_runtime import get_current_runtime
from lightrag.constants import (
    FILE_EXTRACTION_SUMMARY_PREFIX,
    FULL_DOCS_FORMAT_PENDING_PARSE,
    PARSED_DIR_NAME,
    PROCESS_OPTION_CHUNK_FIXED,
    PROCESS_OPTION_CHUNK_PARAGRAH,
    PROCESS_OPTION_CHUNK_RECURSIVE,
    PROCESS_OPTION_CHUNK_VECTOR,
)
from lightrag.parser.routing import (
    FilenameParserHintError,
    chunk_strategy_key,
    resolve_chunk_options,
    resolve_file_parser_directives,
)
from lightrag.utils_pipeline import (
    doc_status_field,
    get_existing_doc_by_file_basename,
    normalize_document_file_path,
)
from ..config import global_args


@lru_cache(maxsize=1)
def _is_docling_available() -> bool:
    """Check if docling is available (cached check).

    This function uses lru_cache to avoid repeated import attempts.
    The result is cached after the first call.

    Returns:
        bool: True if docling is available, False otherwise
    """
    try:
        import docling  # noqa: F401  # type: ignore[import-not-found]

        return True
    except ImportError:
        return False


# Function to format datetime to ISO format string with timezone information
def format_datetime(dt: Any) -> Optional[str]:
    """Format datetime to ISO format string with timezone information

    Args:
        dt: Datetime object, string, or None

    Returns:
        ISO format string with timezone information, or None if input is None
    """
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt

    # Check if datetime object has timezone information
    if isinstance(dt, datetime):
        # If datetime object has no timezone info (naive datetime), add UTC timezone
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

    # Return ISO format string with timezone information
    return dt.isoformat()


def _map_custom_chunks_import_error(exc: Exception) -> HTTPException | None:
    message = str(exc)
    if "exceeds embedding token limit" not in message:
        return None

    return HTTPException(
        status_code=400,
        detail=(
            "Custom chunk exceeds embedding token limit. "
            f"Split oversized chunks and retry. Details: {message}"
        ),
    )


# NOTE: the APIRouter instance is created INSIDE `create_document_routes`
# (not at module scope). A module-level router is shared across processes,
# and re-running the factory — which the test suite does to validate
# create_app for different `--api-prefix` values — would re-decorate the
# same router each time, accumulating duplicate routes and triggering
# FastAPI's "Duplicate Operation ID" warnings.

# Temporary file prefix
temp_prefix = "__tmp__"
UNKNOWN_FILE_SOURCE = "unknown_source"
LEGACY_EMPTY_FILE_PATH_SENTINELS = {"", "no-file-path"}
PARSER_HINT_FILE_RE = re.compile(
    r"^(?P<stem>.+)\.\[(?:legacy|native|mineru|docling)\](?:_\d{3})?(?P<suffix>\.[^.]+)$"
)
NUMERIC_ARCHIVE_FILE_RE = re.compile(r"^(?P<stem>.+)_\d{3}(?P<suffix>\.[^.]+)$")
PARSED_ARTIFACT_DIR_RE = re.compile(
    r"^(?P<file_path>.+)\.(?:parsed|mineru_raw)(?:_\d{3})?$"
)


def _unwrap_doc_status_match(match: Any) -> tuple[str | None, Any | None]:
    if not match:
        return None, None
    if isinstance(match, tuple) and len(match) == 2:
        return match[0], match[1]
    return None, match


async def _get_existing_doc_by_file_source(
    doc_status: Any, file_source: str | None
) -> Any | None:
    if (
        not file_source
        or not file_source.strip()
        or file_source == UNKNOWN_FILE_SOURCE
    ):
        return None

    if hasattr(doc_status, "get_doc_by_file_basename"):
        _, existing_doc = _unwrap_doc_status_match(
            await get_existing_doc_by_file_basename(doc_status, file_source)
        )
        if existing_doc:
            return existing_doc

    get_doc_by_file_path = getattr(doc_status, "get_doc_by_file_path", None)
    if get_doc_by_file_path is None:
        return None
    return await get_doc_by_file_path(file_source)


async def _get_doc_status_by_id(doc_status: Any, doc_id: str) -> Any | None:
    get_by_id = getattr(doc_status, "get_by_id", None)
    if get_by_id is None:
        return None
    return await get_by_id(doc_id)


def normalize_file_path(file_path: str | None) -> str:
    """Normalize missing document sources to a single non-null sentinel."""
    if file_path is None:
        return UNKNOWN_FILE_SOURCE

    normalized = file_path.strip()
    if normalized in LEGACY_EMPTY_FILE_PATH_SENTINELS:
        return UNKNOWN_FILE_SOURCE

    return normalized


def _file_path_for_parsed_artifact_dir(dirname: str) -> str | None:
    """Return canonical source file name for parsed artifact directories."""

    match = PARSED_ARTIFACT_DIR_RE.match(dirname)
    if match is None:
        return None
    return match.group("file_path")


def _file_variant_canonical_name(filename: str, *, allow_numeric_suffix: bool) -> str:
    hint_match = PARSER_HINT_FILE_RE.match(filename)
    if hint_match is not None:
        return f"{hint_match.group('stem')}{hint_match.group('suffix')}"

    if allow_numeric_suffix:
        numeric_match = NUMERIC_ARCHIVE_FILE_RE.match(filename)
        if numeric_match is not None:
            return f"{numeric_match.group('stem')}{numeric_match.group('suffix')}"

    return filename


def _delete_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def delete_file_variants_by_file_path(
    input_dir: Path, file_path: str
) -> tuple[list[str], list[str]]:
    """Delete source, parsed archive, and parser artifact variants for a document."""

    safe_file_path = validate_file_path_security(file_path, input_dir)
    if safe_file_path is None:
        return [], [f"Unsafe file path: {file_path}"]

    target_name = safe_file_path.name
    candidates: list[Path] = []
    parsed_root = input_dir / PARSED_DIR_NAME

    if safe_file_path.exists():
        candidates.append(safe_file_path)

    if input_dir.exists():
        for child in input_dir.iterdir():
            if child == safe_file_path or not child.is_file():
                continue
            if _file_variant_canonical_name(
                child.name, allow_numeric_suffix=False
            ) == target_name:
                candidates.append(child)

    if parsed_root.exists():
        for child in parsed_root.iterdir():
            artifact_source = _file_path_for_parsed_artifact_dir(child.name)
            if artifact_source == target_name:
                candidates.append(child)
                continue

            if _file_variant_canonical_name(
                child.name, allow_numeric_suffix=True
            ) == target_name:
                candidates.append(child)

    deleted_files: list[str] = []
    errors: list[str] = []
    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)

        try:
            _delete_path(candidate)
            deleted_files.append(str(candidate.relative_to(input_dir)))
        except Exception as exc:
            errors.append(f"{candidate.relative_to(input_dir)}: {exc}")

    return deleted_files, errors


def sanitize_filename(filename: str, input_dir: Path) -> str:
    """
    Sanitize uploaded filename to prevent Path Traversal attacks.

    Args:
        filename: The original filename from the upload
        input_dir: The target input directory

    Returns:
        str: Sanitized filename that is safe to use

    Raises:
        HTTPException: If the filename is unsafe or invalid
    """
    # Basic validation
    if not filename or not filename.strip():
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    # Remove path separators and traversal sequences
    clean_name = filename.replace("/", "").replace("\\", "")
    clean_name = clean_name.replace("..", "")

    # Remove control characters and null bytes
    clean_name = "".join(c for c in clean_name if ord(c) >= 32 and c != "\x7f")

    # Remove leading/trailing whitespace and dots
    clean_name = clean_name.strip().strip(".")

    # Check if anything is left after sanitization
    if not clean_name:
        raise HTTPException(
            status_code=400, detail="Invalid filename after sanitization"
        )

    # Verify the final path stays within the input directory
    try:
        final_path = (input_dir / clean_name).resolve()
        if not final_path.is_relative_to(input_dir.resolve()):
            raise HTTPException(status_code=400, detail="Unsafe filename detected")
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid filename")

    return clean_name


class ScanResponse(BaseModel):
    """Response model for document scanning operation

    Attributes:
        status: Status of the scanning operation
        message: Optional message with additional details
        track_id: Tracking ID for monitoring scanning progress
    """

    status: Literal["scanning_started", "scanning_skipped_pipeline_busy"] = Field(
        description="Status of the scanning operation"
    )
    message: Optional[str] = Field(
        default=None, description="Additional details about the scanning operation"
    )
    track_id: str = Field(description="Tracking ID for monitoring scanning progress")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "scanning_started",
                "message": "Scanning process has been initiated in the background",
                "track_id": "scan_20250729_170612_abc123",
            }
        }
    )


class ReprocessResponse(BaseModel):
    """Response model for reprocessing failed documents operation

    Attributes:
        status: Status of the reprocessing operation
        message: Message describing the operation result
        track_id: Always empty string. Reprocessed documents retain their original track_id.
    """

    status: Literal["reprocessing_started"] = Field(
        description="Status of the reprocessing operation"
    )
    message: str = Field(description="Human-readable message describing the operation")
    track_id: str = Field(
        default="",
        description="Always empty string. Reprocessed documents retain their original track_id from initial upload.",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "reprocessing_started",
                "message": "Reprocessing of failed documents has been initiated in background",
                "track_id": "",
            }
        }
    )


class CancelPipelineResponse(BaseModel):
    """Response model for pipeline cancellation operation

    Attributes:
        status: Status of the cancellation request
        message: Message describing the operation result
    """

    status: Literal["cancellation_requested", "not_busy"] = Field(
        description="Status of the cancellation request"
    )
    message: str = Field(description="Human-readable message describing the operation")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "cancellation_requested",
                "message": "Pipeline cancellation has been requested. Documents will be marked as FAILED.",
            }
        }
    )

class RebuildFromIndexingVersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: str = Field(min_length=1, description="Selected indexing version ID")

    @field_validator("version_id", mode="after")
    @classmethod
    def validate_version_id(cls, version_id: str) -> str:
        normalized = version_id.strip()
        if not normalized:
            raise ValueError("version_id cannot be empty")
        return normalized


class RebuildDocumentsResponse(BaseModel):
    status: Literal["rebuild_started", "busy"] = Field(
        description="Status of the rebuild operation"
    )
    message: str = Field(description="Human-readable message describing the operation")
    track_id: str = Field(
        default="",
        description="Tracking ID for the rebuild pipeline, empty when not started",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "rebuild_started",
                "message": "Workspace rebuild has been initiated in the background.",
                "track_id": "rebuild_20260326_abc123",
            }
        }
    )


class CustomChunksGraphRebuildResponse(BaseModel):
    status: Literal["rebuild_started", "busy"] = Field(
        description="Status of the custom chunk graph rebuild operation"
    )
    message: str = Field(description="Human-readable message describing the operation")
    track_id: str = Field(
        default="",
        description="Reserved tracking ID field, empty for this operation",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "rebuild_started",
                "message": "Custom chunk graph rebuild has been initiated in the background.",
                "track_id": "",
            }
        }
    )


class RebuildGraphsRequest(BaseModel):
    doc_ids: Optional[list[str]] = Field(
        default=None,
        description="Optional list of document IDs to rebuild. When omitted, rebuild all custom chunk graphs.",
    )

    @field_validator("doc_ids", mode="after")
    @classmethod
    def validate_doc_ids(
        cls, doc_ids: Optional[list[str]]
    ) -> Optional[list[str]]:
        if doc_ids is None:
            return None

        validated_ids: list[str] = []
        for doc_id in doc_ids:
            if not isinstance(doc_id, str) or not doc_id.strip():
                raise ValueError("Document ID cannot be empty")
            normalized = doc_id.strip()
            if normalized not in validated_ids:
                validated_ids.append(normalized)

        return validated_ids


TextChunkingStrategy = Literal[
    "fixed_token",
    "recursive_character",
    "semantic_vector",
    "paragraph_semantic",
]


class _StrictChunkParams(BaseModel):
    """Base for per-strategy chunking params.

    ``strict=True`` rejects the Pydantic-v2 lax coercions that would
    otherwise let malformed requests through and fail later in the
    background chunker: bool-as-int (``true`` -> 1), numeric strings
    (``"5"`` -> 5), float-as-int.  ``extra="forbid"`` turns unknown keys
    into a 422 (replacing a hand-rolled allow-list).  ``chunk_token_size``
    is shared by every strategy; ``None`` means "not supplied — fall back
    to ``addon_params``/env default at process time".
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    chunk_token_size: Optional[int] = Field(default=None, ge=1)


class _OverlapChunkParams(_StrictChunkParams):
    chunk_overlap_token_size: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _overlap_lt_size(self) -> "_OverlapChunkParams":
        # Only enforceable when BOTH are explicit; when chunk_token_size
        # is None the effective size is resolved from addon_params/env at
        # process time and can't be compared against here.
        if (
            self.chunk_token_size is not None
            and self.chunk_overlap_token_size is not None
            and self.chunk_overlap_token_size >= self.chunk_token_size
        ):
            raise ValueError("chunk_overlap_token_size must be < chunk_token_size")
        return self


class FixedTokenChunkParams(_OverlapChunkParams):
    split_by_character: Optional[str] = None
    split_by_character_only: Optional[bool] = None


class RecursiveCharacterChunkParams(_OverlapChunkParams):
    separators: Optional[list[str]] = None


class ParagraphSemanticChunkParams(_OverlapChunkParams):
    pass


class SemanticVectorChunkParams(_StrictChunkParams):
    # Enum verified against the installed langchain_experimental
    # (text_splitter.py ``BreakpointThresholdType``), not from memory.
    breakpoint_threshold_type: Optional[
        Literal["percentile", "standard_deviation", "interquartile", "gradient"]
    ] = None
    # A strict ``float`` field still accepts an ``int`` (e.g. JSON ``95``) and
    # widens it losslessly to ``95.0`` — strict only rejects ``str`` / ``bool``
    # here, which is exactly what we want. Do NOT relax strict (that would let
    # numeric strings through) or switch to ``int | float`` (that would stop
    # normalizing ints to float). Locked by tests in test_document_routes_chunking.
    breakpoint_threshold_amount: Optional[float] = None
    buffer_size: Optional[int] = Field(default=None, ge=1)
    sentence_split_regex: Optional[str] = None

    @field_validator("sentence_split_regex")
    @classmethod
    def _valid_sentence_split_regex(cls, v: Optional[str]) -> Optional[str]:
        # The value is fed to LangChain's SemanticChunker and compiled during
        # split_text. A malformed pattern (e.g. "(") would only blow up in the
        # background, so compile it here to reject synchronously (HTTP 422).
        if v is None:
            return v
        try:
            re.compile(v)
        except re.error as exc:
            raise ValueError(
                f"sentence_split_regex is not a valid regular expression: {exc}"
            ) from exc
        return v

    @model_validator(mode="after")
    def _amount_in_range(self) -> "SemanticVectorChunkParams":
        amt = self.breakpoint_threshold_amount
        if amt is None:
            return self
        # ``> 0`` is type-independent (every threshold type wants a positive
        # magnitude), so it is safe to enforce at parse time.
        if amt <= 0:
            raise ValueError("breakpoint_threshold_amount must be > 0")
        # The ``(0, 100]`` ceiling is percentile/gradient-specific (those feed
        # np.percentile, which requires q in [0, 100]). It depends on the
        # threshold TYPE, so only enforce it here when the type is supplied in
        # the SAME request. When the type is omitted, the effective type is
        # resolved from addon_params/env later — assuming "percentile" here
        # would wrongly 422 a partial override that inherits
        # standard_deviation/interquartile (which allow amounts > 100). The
        # ceiling against the merged type is applied by
        # ``_validate_effective_semantic_amount`` in ``_resolve_text_chunking``.
        if self.breakpoint_threshold_type in ("percentile", "gradient") and amt > 100:
            raise ValueError(
                "breakpoint_threshold_amount must be within (0, 100] "
                "for percentile/gradient"
            )
        return self


_CHUNKING_PARAMS_MODEL: dict[str, type[_StrictChunkParams]] = {
    "fixed_token": FixedTokenChunkParams,
    "recursive_character": RecursiveCharacterChunkParams,
    "semantic_vector": SemanticVectorChunkParams,
    "paragraph_semantic": ParagraphSemanticChunkParams,
}


class TextChunkingConfig(BaseModel):
    """Chunking strategy + strategy-specific params for a text insert.

    Validation is delegated to the per-strategy typed model so unknown
    keys, wrong types, and out-of-range values all raise synchronously
    during request parsing (HTTP 422) — never later in the background
    indexing task, where the HTTP response has already been sent.
    """

    model_config = ConfigDict(extra="forbid")

    strategy: TextChunkingStrategy = "fixed_token"
    params: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_params(self) -> "TextChunkingConfig":
        typed = _CHUNKING_PARAMS_MODEL[self.strategy].model_validate(self.params)
        # Normalize down to exactly the keys the caller supplied with a real
        # value (validated + coerced) so the enqueue-time merge overrides only
        # what was set. ``exclude_none`` additionally drops explicit nulls:
        # every param field means "inherit the addon_params/env default" when
        # None, so an explicit ``"chunk_token_size": null`` must NOT be merged
        # over the resolved default — otherwise the route would 200 and the
        # background chunker would do ``int(None)`` and fail the document.
        self.params = typed.model_dump(exclude_unset=True, exclude_none=True)
        return self


class InsertTextRequest(BaseModel):
    """Request model for inserting a single text document

    Attributes:
        text: The text content to be inserted into the RAG system
        file_source: Source of the text (optional)
        chunking: Optional chunking strategy + params; omit to keep the
            default fixed-token behavior and addon_params defaults.
    """

    text: str = Field(
        min_length=1,
        description="The text to insert",
    )
    file_source: Optional[str] = Field(
        default=None, min_length=0, description="File Source"
    )
    chunking: Optional[TextChunkingConfig] = Field(
        default=None,
        description="Chunking strategy and params; omit for default fixed-token chunking",
    )

    @field_validator("text", mode="after")
    @classmethod
    def strip_text_after(cls, text: str) -> str:
        return text.strip()

    @field_validator("file_source", mode="before")
    @classmethod
    def normalize_source_before(cls, file_source: Optional[str]) -> str:
        return normalize_file_path(file_source)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "text": "This is a sample text to be inserted into the RAG system.",
                "file_source": "Source of the text (optional)",
                "chunking": {
                    "strategy": "fixed_token",
                    "params": {
                        "chunk_token_size": 1200,
                        "chunk_overlap_token_size": 100,
                        "split_by_character": "\n\n",
                        "split_by_character_only": True,
                    },
                },
            }
        }
    )


class InsertTextsRequest(BaseModel):
    """Request model for inserting multiple text documents

    Attributes:
        texts: List of text contents to be inserted into the RAG system
        file_sources: Sources of the texts (optional)
    """

    texts: list[str] = Field(
        min_length=1,
        description="The texts to insert",
    )
    file_sources: Optional[list[str]] = Field(
        default=None, min_length=0, description="Sources of the texts"
    )
    chunking: Optional[TextChunkingConfig] = Field(
        default=None,
        description="Shared chunking strategy and params for all texts; omit for default fixed-token chunking",
    )

    @field_validator("texts", mode="after")
    @classmethod
    def strip_texts_after(cls, texts: list[str]) -> list[str]:
        return [text.strip() for text in texts]

    @field_validator("file_sources", mode="before")
    @classmethod
    def normalize_sources_before(
        cls, file_sources: Optional[list[str]]
    ) -> Optional[list[str]]:
        if file_sources is None:
            return None

        return [normalize_file_path(file_source) for file_source in file_sources]

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "texts": [
                    "This is the first text to be inserted.",
                    "This is the second text to be inserted.",
                ],
                "file_sources": [
                    "First file source (optional)",
                ],
                "chunking": {
                    "strategy": "recursive_character",
                    "params": {"chunk_token_size": 1000},
                },
            }
        }
    )


class InsertResponse(BaseModel):
    """Response model for document insertion operations

    Attributes:
        status: Status of the operation (success, duplicated, partial_success, failure)
        message: Detailed message describing the operation result
        track_id: Tracking ID for monitoring processing status
    """

    status: Literal["success", "duplicated", "partial_success", "failure"] = Field(
        description="Status of the operation"
    )
    message: str = Field(description="Message describing the operation result")
    track_id: str = Field(description="Tracking ID for monitoring processing status")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "success",
                "message": "File 'document.pdf' uploaded successfully. Processing will continue in background.",
                "track_id": "upload_20250729_170612_abc123",
            }
        }
    )


class ClearDocumentsResponse(BaseModel):
    """Response model for document clearing operation

    Attributes:
        status: Status of the clear operation
        message: Detailed message describing the operation result
    """

    status: Literal["success", "partial_success", "busy", "fail"] = Field(
        description="Status of the clear operation"
    )
    message: str = Field(description="Message describing the operation result")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "success",
                "message": "All documents cleared successfully. Deleted 15 files.",
            }
        }
    )


class ClearCacheRequest(BaseModel):
    """Request model for clearing cache

    This model is kept for API compatibility but no longer accepts any parameters.
    All cache will be cleared regardless of the request content.
    """

    model_config = ConfigDict(json_schema_extra={"example": {}})


class ClearCacheResponse(BaseModel):
    """Response model for cache clearing operation

    Attributes:
        status: Status of the clear operation
        message: Detailed message describing the operation result
    """

    status: Literal["success", "fail"] = Field(
        description="Status of the clear operation"
    )
    message: str = Field(description="Message describing the operation result")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "success",
                "message": "Successfully cleared cache for modes: ['default', 'naive']",
            }
        }
    )


"""Response model for document status

Attributes:
    id: Document identifier
    content_summary: Summary of document content
    content_length: Length of document content
    status: Current processing status
    created_at: Creation timestamp (ISO format string)
    updated_at: Last update timestamp (ISO format string)
    chunks_count: Number of chunks (optional)
    error: Error message if any (optional)
    metadata: Additional metadata (optional)
    file_path: Path to the document file
"""


class DeleteDocRequest(BaseModel):
    doc_ids: List[str] = Field(..., description="The IDs of the documents to delete.")
    delete_file: bool = Field(
        default=False,
        description="Whether to delete the corresponding file in the upload directory.",
    )
    delete_llm_cache: bool = Field(
        default=False,
        description="Whether to delete cached LLM extraction results for the documents.",
    )

    @field_validator("doc_ids", mode="after")
    @classmethod
    def validate_doc_ids(cls, doc_ids: List[str]) -> List[str]:
        if not doc_ids:
            raise ValueError("Document IDs list cannot be empty")

        validated_ids = []
        for doc_id in doc_ids:
            if not doc_id or not doc_id.strip():
                raise ValueError("Document ID cannot be empty")
            validated_ids.append(doc_id.strip())

        # Check for duplicates
        if len(validated_ids) != len(set(validated_ids)):
            raise ValueError("Document IDs must be unique")

        return validated_ids


class DocStatusResponse(BaseModel):
    id: str = Field(description="Document identifier")
    content_summary: str = Field(description="Summary of document content")
    content_length: int = Field(description="Length of document content in characters")
    status: DocStatus = Field(description="Current processing status")
    created_at: str = Field(description="Creation timestamp (ISO format string)")
    updated_at: str = Field(description="Last update timestamp (ISO format string)")
    track_id: Optional[str] = Field(
        default=None, description="Tracking ID for monitoring progress"
    )
    chunks_count: Optional[int] = Field(
        default=None, description="Number of chunks the document was split into"
    )
    error_msg: Optional[str] = Field(
        default=None, description="Error message if processing failed"
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None, description="Additional metadata about the document"
    )
    file_path: str = Field(description="Path to the document file")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "doc_123456",
                "content_summary": "Research paper on machine learning",
                "content_length": 15240,
                "status": "processed",
                "created_at": "2025-03-31T12:34:56",
                "updated_at": "2025-03-31T12:35:30",
                "track_id": "upload_20250729_170612_abc123",
                "chunks_count": 12,
                "error": None,
                "metadata": {"author": "John Doe", "year": 2025},
                "file_path": "research_paper.pdf",
            }
        }
    )


class DocsStatusesResponse(BaseModel):
    """Response model for document statuses

    Attributes:
        statuses: Dictionary mapping document status to lists of document status responses
    """

    statuses: Dict[DocStatus, List[DocStatusResponse]] = Field(
        default_factory=dict,
        description="Dictionary mapping document status to lists of document status responses",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "statuses": {
                    "PENDING": [
                        {
                            "id": "doc_123",
                            "content_summary": "Pending document",
                            "content_length": 5000,
                            "status": "pending",
                            "created_at": "2025-03-31T10:00:00",
                            "updated_at": "2025-03-31T10:00:00",
                            "track_id": "upload_20250331_100000_abc123",
                            "chunks_count": None,
                            "error": None,
                            "metadata": None,
                            "file_path": "pending_doc.pdf",
                        }
                    ],
                    "PREPROCESSED": [
                        {
                            "id": "doc_789",
                            "content_summary": "Document pending final indexing",
                            "content_length": 7200,
                            "status": "preprocessed",
                            "created_at": "2025-03-31T09:30:00",
                            "updated_at": "2025-03-31T09:35:00",
                            "track_id": "upload_20250331_093000_xyz789",
                            "chunks_count": 10,
                            "error": None,
                            "metadata": None,
                            "file_path": "preprocessed_doc.pdf",
                        }
                    ],
                    "PROCESSED": [
                        {
                            "id": "doc_456",
                            "content_summary": "Processed document",
                            "content_length": 8000,
                            "status": "processed",
                            "created_at": "2025-03-31T09:00:00",
                            "updated_at": "2025-03-31T09:05:00",
                            "track_id": "insert_20250331_090000_def456",
                            "chunks_count": 8,
                            "error": None,
                            "metadata": {"author": "John Doe"},
                            "file_path": "processed_doc.pdf",
                        }
                    ],
                }
            }
        }
    )


class TrackStatusResponse(BaseModel):
    """Response model for tracking document processing status by track_id

    Attributes:
        track_id: The tracking ID
        documents: List of documents associated with this track_id
        total_count: Total number of documents for this track_id
        status_summary: Count of documents by status
    """

    track_id: str = Field(description="The tracking ID")
    documents: List[DocStatusResponse] = Field(
        description="List of documents associated with this track_id"
    )
    total_count: int = Field(description="Total number of documents for this track_id")
    status_summary: Dict[str, int] = Field(description="Count of documents by status")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "track_id": "upload_20250729_170612_abc123",
                "documents": [
                    {
                        "id": "doc_123456",
                        "content_summary": "Research paper on machine learning",
                        "content_length": 15240,
                        "status": "PROCESSED",
                        "created_at": "2025-03-31T12:34:56",
                        "updated_at": "2025-03-31T12:35:30",
                        "track_id": "upload_20250729_170612_abc123",
                        "chunks_count": 12,
                        "error": None,
                        "metadata": {"author": "John Doe", "year": 2025},
                        "file_path": "research_paper.pdf",
                    }
                ],
                "total_count": 1,
                "status_summary": {"PROCESSED": 1},
            }
        }
    )


class DocumentsRequest(BaseModel):
    """Request model for paginated document queries

    Attributes:
        status_filter: Filter by document status, None for all statuses
        page: Page number (1-based)
        page_size: Number of documents per page (10-200)
        sort_field: Field to sort by ('created_at', 'updated_at', 'id', 'file_path')
        sort_direction: Sort direction ('asc' or 'desc')
    """

    status_filter: Optional[DocStatus] = Field(
        default=None, description="Filter by document status, None for all statuses"
    )
    status_filters: Optional[list[DocStatus]] = Field(
        default=None,
        description="Filter by multiple document statuses. Takes precedence over status_filter.",
    )
    page: int = Field(default=1, ge=1, description="Page number (1-based)")
    page_size: int = Field(
        default=50, ge=10, le=200, description="Number of documents per page (10-200)"
    )
    sort_field: Literal["created_at", "updated_at", "id", "file_path"] = Field(
        default="updated_at", description="Field to sort by"
    )
    sort_direction: Literal["asc", "desc"] = Field(
        default="desc", description="Sort direction"
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status_filter": "PROCESSED",
                "status_filters": ["PARSING", "ANALYZING"],
                "page": 1,
                "page_size": 50,
                "sort_field": "updated_at",
                "sort_direction": "desc",
            }
        }
    )


class PaginationInfo(BaseModel):
    """Pagination information

    Attributes:
        page: Current page number
        page_size: Number of items per page
        total_count: Total number of items
        total_pages: Total number of pages
        has_next: Whether there is a next page
        has_prev: Whether there is a previous page
    """

    page: int = Field(description="Current page number")
    page_size: int = Field(description="Number of items per page")
    total_count: int = Field(description="Total number of items")
    total_pages: int = Field(description="Total number of pages")
    has_next: bool = Field(description="Whether there is a next page")
    has_prev: bool = Field(description="Whether there is a previous page")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "page": 1,
                "page_size": 50,
                "total_count": 150,
                "total_pages": 3,
                "has_next": True,
                "has_prev": False,
            }
        }
    )


class PaginatedDocsResponse(BaseModel):
    """Response model for paginated document queries

    Attributes:
        documents: List of documents for the current page
        pagination: Pagination information
        status_counts: Count of documents by status for all documents
    """

    documents: List[DocStatusResponse] = Field(
        description="List of documents for the current page"
    )
    pagination: PaginationInfo = Field(description="Pagination information")
    status_counts: Dict[str, int] = Field(
        description="Count of documents by status for all documents"
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "documents": [
                    {
                        "id": "doc_123456",
                        "content_summary": "Research paper on machine learning",
                        "content_length": 15240,
                        "status": "PROCESSED",
                        "created_at": "2025-03-31T12:34:56",
                        "updated_at": "2025-03-31T12:35:30",
                        "track_id": "upload_20250729_170612_abc123",
                        "chunks_count": 12,
                        "error_msg": None,
                        "metadata": {"author": "John Doe", "year": 2025},
                        "file_path": "research_paper.pdf",
                    }
                ],
                "pagination": {
                    "page": 1,
                    "page_size": 50,
                    "total_count": 150,
                    "total_pages": 3,
                    "has_next": True,
                    "has_prev": False,
                },
                "status_counts": {
                    "PENDING": 10,
                    "PROCESSING": 5,
                    "PREPROCESSED": 5,
                    "PROCESSED": 130,
                    "FAILED": 5,
                },
            }
        }
    )


class StatusCountsResponse(BaseModel):
    """Response model for document status counts

    Attributes:
        status_counts: Count of documents by status
    """

    status_counts: Dict[str, int] = Field(description="Count of documents by status")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status_counts": {
                    "PENDING": 10,
                    "PROCESSING": 5,
                    "PREPROCESSED": 5,
                    "PROCESSED": 130,
                    "FAILED": 5,
                }
            }
        }
    )


class CustomChunksImportRequest(BaseModel):
    full_text: str = Field(min_length=1, description="Full document text")
    text_chunks: list[str] = Field(
        min_length=1, description="Pre-split text chunks to import"
    )
    doc_id: Optional[str] = Field(
        default=None,
        description="Optional document ID. If omitted, it will be derived from full_text.",
    )
    file_path: Optional[str] = Field(
        default=None,
        description="Optional source file path for display and metadata.",
    )

    @field_validator("full_text", mode="after")
    @classmethod
    def strip_full_text_after(cls, full_text: str) -> str:
        return full_text.strip()

    @field_validator("text_chunks", mode="after")
    @classmethod
    def strip_text_chunks_after(cls, text_chunks: list[str]) -> list[str]:
        stripped_chunks = [chunk.strip() for chunk in text_chunks]
        if not all(stripped_chunks):
            raise ValueError("Text chunks cannot contain empty values")
        return stripped_chunks

    @field_validator("doc_id", mode="before")
    @classmethod
    def normalize_doc_id_before(cls, doc_id: Optional[str]) -> Optional[str]:
        if doc_id is None:
            return None
        normalized = doc_id.strip()
        return normalized or None

    @field_validator("file_path", mode="before")
    @classmethod
    def normalize_file_path_before(cls, file_path: Optional[str]) -> Optional[str]:
        if file_path is None:
            return None
        normalized = file_path.strip()
        return normalized or None


class CustomChunksImportResponse(BaseModel):
    status: Literal["success"] = Field(description="Import status")
    message: str = Field(description="Result message")
    doc_id: str = Field(description="Resolved document ID used for import")
    requested_chunk_count: int = Field(description="Number of chunks submitted")


class DocumentChunkResponse(BaseModel):
    id: str = Field(description="Chunk identifier")
    content: str = Field(description="Chunk text content")
    tokens: Optional[int] = Field(
        default=None, description="Token count for the chunk if available"
    )
    order: int = Field(description="Original chunk order within the document")


class DocumentChunksResponse(BaseModel):
    doc_id: str = Field(description="Document identifier")
    chunk_count: int = Field(description="Number of chunks returned")
    chunks: list[DocumentChunkResponse] = Field(
        default_factory=list, description="Chunk payloads in document order"
    )


class DocumentsByIdsRequest(BaseModel):
    doc_ids: list[str] = Field(min_length=1, description="Document IDs to fetch")

    @field_validator("doc_ids", mode="after")
    @classmethod
    def validate_doc_ids(cls, doc_ids: list[str]) -> list[str]:
        if not doc_ids:
            raise ValueError("Document IDs list cannot be empty")

        validated_ids: list[str] = []
        for doc_id in doc_ids:
            if not doc_id or not doc_id.strip():
                raise ValueError("Document ID cannot be empty")
            validated_ids.append(doc_id.strip())

        if len(validated_ids) != len(set(validated_ids)):
            raise ValueError("Document IDs must be unique")

        return validated_ids


class DocumentsByIdsResponse(BaseModel):
    documents: list[DocStatusResponse] = Field(
        description="Documents found for the requested IDs"
    )
    requested_count: int = Field(description="Number of requested document IDs")
    found_count: int = Field(description="Number of found documents")
    missing_doc_ids: list[str] = Field(
        default_factory=list, description="Requested IDs not found in storage"
    )


class PipelineStatusResponse(BaseModel):
    """Response model for pipeline status

    Attributes:
        autoscanned: Whether auto-scan has started
        busy: Whether the pipeline is currently busy
        job_name: Current job name (e.g., indexing files/indexing texts)
        job_start: Job start time as ISO format string with timezone (optional)
        docs: Total number of documents to be indexed
        batchs: Number of batches for processing documents
        cur_batch: Current processing batch
        request_pending: Flag for pending request for processing
        latest_message: Latest message from pipeline processing
        history_messages: List of history messages
        update_status: Status of update flags for all namespaces
    """

    autoscanned: bool = False
    busy: bool = False
    job_name: str = "Default Job"
    job_start: Optional[str] = None
    docs: int = 0
    batchs: int = 0
    cur_batch: int = 0
    request_pending: bool = False
    latest_message: str = ""
    history_messages: Optional[List[str]] = None
    update_status: Optional[dict] = None

    @field_validator("job_start", mode="before")
    @classmethod
    def parse_job_start(cls, value):
        """Process datetime and return as ISO format string with timezone"""
        return format_datetime(value)

    model_config = ConfigDict(extra="allow")


def _to_doc_status_response(
    doc_id: str, doc_status: DocProcessingStatus
) -> DocStatusResponse:
    return DocStatusResponse(
        id=doc_id,
        content_summary=doc_status.content_summary,
        content_length=doc_status.content_length,
        status=doc_status.status,
        created_at=format_datetime(doc_status.created_at),
        updated_at=format_datetime(doc_status.updated_at),
        track_id=doc_status.track_id,
        chunks_count=doc_status.chunks_count,
        error_msg=doc_status.error_msg,
        metadata=doc_status.metadata,
        file_path=normalize_file_path(doc_status.file_path),
    )


class DocumentManager:
    def __init__(
        self,
        input_dir: str,
        workspace: str = "",  # New parameter for workspace isolation
    ):
        # Reject path traversal before using workspace in the upload path
        validate_workspace(workspace)
        # Store the base input directory and workspace
        self.base_input_dir = Path(input_dir)
        self.workspace = workspace
        self.indexed_files = set()

        # Create workspace-specific input directory
        # If workspace is provided, create a subdirectory for data isolation
        if workspace:
            self.input_dir = self.base_input_dir / workspace
        else:
            self.input_dir = self.base_input_dir

        # Create input directory if it doesn't exist
        self.input_dir.mkdir(parents=True, exist_ok=True)

    @property
    def supported_extensions(self) -> tuple:
        """Suffixes accepted for an unhinted filename, derived live.

        A suffix is advertised only when it is *routable without extra
        directives*: the engine that ``resolve_file_parser_engine`` picks for
        a bare ``x.<suffix>`` (filename hint absent; ``LIGHTRAG_PARSER``
        rules + default apply) must itself support the suffix. This keeps
        "uploadable" aligned with "will actually parse": e.g. mineru's
        ``png`` joins only when its endpoint is configured AND a routing
        rule (or per-file hint, see ``is_supported_file``) sends pngs to it
        — otherwise the default ``legacy`` engine would fail the suffix gate
        at the parse stage. A default deployment equals the local engines'
        (legacy ∪ native) types; no hardcoded list to keep in sync.
        """
        from lightrag.parser.registry import available_engine_suffixes
        from lightrag.parser.routing import (
            parser_engine_supports_suffix,
            resolve_file_parser_engine,
        )

        out = []
        for s in sorted(available_engine_suffixes()):
            engine = resolve_file_parser_engine(f"x.{s}")
            if parser_engine_supports_suffix(engine, s):
                out.append(f".{s}")
        return tuple(out)

    def scan_directory_for_new_files(self) -> List[Path]:
        """Scan input directory for new, routable files.

        Globs over every *available* engine suffix (capability surface, so a
        hint-carrying file like ``img.[mineru].png`` is discoverable even
        when bare ``.png`` is not advertised), then keeps only files whose
        resolved engine actually supports them (``is_supported_file``).
        """
        from lightrag.parser.registry import available_engine_suffixes
        from lightrag.parser.routing import FilenameParserHintError

        new_files = []
        for s in sorted(available_engine_suffixes()):
            ext = f".{s}"
            logger.debug(f"Scanning for {ext} files in {self.input_dir}")
            for file_path in self.input_dir.glob(f"*{ext}"):
                if file_path in self.indexed_files:
                    continue
                try:
                    if not self.is_supported_file(file_path.name):
                        continue
                except FilenameParserHintError:
                    # Malformed hint: pass the file through — the enqueue
                    # path reports a detailed error document, instead of the
                    # scan silently ignoring the user's file.
                    pass
                new_files.append(file_path)
        return new_files

    def mark_as_indexed(self, file_path: Path):
        self.indexed_files.add(file_path)

    def reset_indexed_files(self):
        self.indexed_files.clear()

    def is_supported_file(self, filename: str) -> bool:
        """True when THIS filename routes to an engine that can parse it.

        Resolves the engine for the concrete name — so a per-file hint
        (``img.[mineru].png``) is honoured — and checks the resolved engine
        supports the suffix. A bare suffix that would fall through to the
        default ``legacy`` engine is rejected here instead of failing later
        at the parse worker's suffix gate.

        Raises :class:`FilenameParserHintError` for a malformed hint —
        callers surface it (upload → HTTP 400 with the detailed message;
        scan passes the file through so enqueue emits an error document).
        """
        from lightrag.parser.routing import (
            parser_engine_supports_suffix,
            parser_suffix,
            resolve_file_parser_engine,
        )

        engine = resolve_file_parser_engine(filename)
        return parser_engine_supports_suffix(engine, parser_suffix(filename))


def validate_file_path_security(file_path_str: str, base_dir: Path) -> Optional[Path]:
    """
    Validate file path security to prevent Path Traversal attacks.

    Args:
        file_path_str: The file path string to validate
        base_dir: The base directory that the file must be within

    Returns:
        Path: Safe file path if valid, None if unsafe or invalid
    """
    if not file_path_str or not file_path_str.strip():
        return None

    try:
        # Clean the file path string
        clean_path_str = file_path_str.strip()

        # Check for obvious path traversal patterns before processing
        # This catches both Unix (..) and Windows (..\) style traversals
        if ".." in clean_path_str:
            # Additional check for Windows-style backslash traversal
            if (
                "\\..\\" in clean_path_str
                or clean_path_str.startswith("..\\")
                or clean_path_str.endswith("\\..")
            ):
                # logger.warning(
                #     f"Security violation: Windows path traversal attempt detected - {file_path_str}"
                # )
                return None

        # Normalize path separators (convert backslashes to forward slashes)
        # This helps handle Windows-style paths on Unix systems
        normalized_path = clean_path_str.replace("\\", "/")

        # Create path object and resolve it (handles symlinks and relative paths)
        candidate_path = (base_dir / normalized_path).resolve()
        base_dir_resolved = base_dir.resolve()

        # Check if the resolved path is within the base directory
        if not candidate_path.is_relative_to(base_dir_resolved):
            # logger.warning(
            #     f"Security violation: Path traversal attempt detected - {file_path_str}"
            # )
            return None

        return candidate_path

    except (OSError, ValueError, Exception) as e:
        logger.warning(f"Invalid file path detected: {file_path_str} - {str(e)}")
        return None


def get_unique_filename_in_enqueued(target_dir: Path, original_name: str) -> str:
    """Generate a unique filename in the target directory by adding numeric suffixes if needed

    Args:
        target_dir: Target directory path
        original_name: Original filename

    Returns:
        str: Unique filename (may have numeric suffix added)
    """
    import time

    original_path = Path(original_name)
    base_name = original_path.stem
    extension = original_path.suffix

    # Try original name first
    if not (target_dir / original_name).exists():
        return original_name

    # Try with numeric suffixes 001-999
    for i in range(1, 1000):
        suffix = f"{i:03d}"
        new_name = f"{base_name}_{suffix}{extension}"
        if not (target_dir / new_name).exists():
            return new_name

    # Fallback with timestamp if all 999 slots are taken
    timestamp = int(time.time())
    return f"{base_name}_{timestamp}{extension}"

def restore_enqueued_files_to_input_dir(doc_manager: DocumentManager) -> list[str]:
    """Move archived source files back to the scan directory before a rebuild."""
    restored_files: list[str] = []
    enqueued_dir = doc_manager.input_dir / "__enqueued__"
    if not enqueued_dir.exists():
        return restored_files

    for file_path in sorted(enqueued_dir.iterdir()):
        if not file_path.is_file():
            continue
        target_name = get_unique_filename_in_enqueued(
            doc_manager.input_dir, file_path.name
        )
        target_path = doc_manager.input_dir / target_name
        file_path.rename(target_path)
        restored_files.append(target_name)

    return restored_files


async def check_pipeline_busy_or_raise(rag: LightRAG) -> None:
    """Refuse the request with HTTP 409 when the document pipeline is busy.

    Intended for short, fine-grained graph mutations (entity/relation
    edit/create/delete/merge). Reads ``pipeline_status['busy']`` under
    the namespace lock and raises immediately on contention -- it does
    NOT set any flag, so it cannot block the pipeline itself.

    ``busy`` is set by the processing loop and by destructive jobs
    (``/documents/clear`` / per-doc delete). Both paths concurrently
    write the same graph storages that these endpoints mutate, so a
    409 here mirrors the existing UI guard and tells clients to wait.

    A narrow race remains between this check and the underlying graph
    write: if the pipeline transitions to busy in that window, the
    per-edge/-node locks inside the storage layer are the last line of
    defense. That trade-off is deliberate -- holding ``busy`` here
    would serialise every UI edit against document ingestion, which is
    a worse user-visible failure mode than tolerating the race.

    No-op (returns silently) when ``pipeline_status`` was never
    bootstrapped, matching the behaviour of ``_acquire_destructive_busy``
    so test rigs without a real shared-storage Manager keep working.
    """
    from lightrag.exceptions import PipelineNotInitializedError
    from lightrag.kg.shared_storage import get_namespace_data, get_namespace_lock

    workspace = getattr(rag, "workspace", None)
    if workspace is None:
        return

    try:
        pipeline_status = await get_namespace_data("pipeline_status", workspace=workspace)
    except PipelineNotInitializedError:
        return
    pipeline_status_lock = get_namespace_lock("pipeline_status", workspace=workspace)
    async with pipeline_status_lock:
        if pipeline_status.get("busy"):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Pipeline is busy with another operation. "
                    "Wait for the running job to finish before editing "
                    "the knowledge graph."
                ),
            )


async def _acquire_destructive_busy(rag: LightRAG) -> tuple[bool, str | None]:
    """Atomically reserve the destructive busy slot for ``/documents/clear``
    or ``/documents/delete_document``.
    """
    from lightrag.exceptions import PipelineNotInitializedError
    from lightrag.kg.shared_storage import get_namespace_data, get_namespace_lock

    try:
        pipeline_status = await get_namespace_data(
            "pipeline_status", workspace=rag.workspace
        )
    except PipelineNotInitializedError:
        return True, None
    pipeline_status_lock = get_namespace_lock(
        "pipeline_status", workspace=rag.workspace
    )
    async with pipeline_status_lock:
        if pipeline_status.get("busy"):
            return False, "Pipeline is busy with another operation."
        if pipeline_status.get("scanning"):
            return False, (
                "Document scan is in progress. "
                "Wait for the scan to complete before clearing or deleting."
            )
        if pipeline_status.get("pending_enqueues", 0) > 0:
            return False, (
                "Document upload/insert is being enqueued. "
                "Wait for in-flight work to complete before clearing or deleting."
            )
        pipeline_status["busy"] = True
        pipeline_status["destructive_busy"] = True
    return True, None


def get_rebuild_storages(rag: LightRAG) -> list[Any]:
    return [
        rag.text_chunks,
        rag.full_docs,
        rag.full_entities,
        rag.full_relations,
        rag.entity_chunks,
        rag.relation_chunks,
        rag.entities_vdb,
        rag.relationships_vdb,
        rag.chunks_vdb,
        rag.chunk_entity_relation_graph,
        rag.llm_response_cache,
        rag.doc_status,
    ]


async def background_rebuild_documents_from_indexing_version(
    rag: LightRAG,
    doc_manager: DocumentManager,
    version_id: str,
    track_id: str,
):
    from lightrag.kg.shared_storage import (
        get_namespace_data,
        get_namespace_lock,
    )

    pipeline_status = await get_namespace_data(
        "pipeline_status", workspace=rag.workspace
    )
    pipeline_status_lock = get_namespace_lock(
        "pipeline_status", workspace=rag.workspace
    )

    async with pipeline_status_lock:
        if pipeline_status.get("busy", False):
            logger.warning("Rebuild aborted because pipeline became busy")
            return
        pipeline_status.update(
            {
                "busy": True,
                "job_name": "Rebuilding Workspace",
                "job_start": datetime.now().isoformat(),
                "docs": 0,
                "batchs": 0,
                "cur_batch": 0,
                "request_pending": False,
                "cancellation_requested": False,
                "latest_message": "Starting workspace rebuild",
            }
        )
        del pipeline_status["history_messages"][:]
        pipeline_status["history_messages"].append(
            f"Starting workspace rebuild from indexing version {version_id}"
        )

    try:
        drop_tasks = [storage.drop() for storage in get_rebuild_storages(rag) if storage]
        drop_results = await asyncio.gather(*drop_tasks, return_exceptions=True)
        drop_errors = [result for result in drop_results if isinstance(result, Exception)]
        if drop_errors:
            error_message = (
                f"Workspace rebuild aborted because {len(drop_errors)} storage reset operations failed."
            )
            logger.error(error_message)
            async with pipeline_status_lock:
                pipeline_status["latest_message"] = error_message
                pipeline_status["history_messages"].append(error_message)
                pipeline_status["busy"] = False
            return

        restored_files = restore_enqueued_files_to_input_dir(doc_manager)
        doc_manager.reset_indexed_files()
        async with pipeline_status_lock:
            handoff_message = (
                f"Reset completed. Restored {len(restored_files)} archived source files. Starting scan."
            )
            pipeline_status["latest_message"] = handoff_message
            pipeline_status["history_messages"].append(handoff_message)
            pipeline_status["busy"] = False
            pipeline_status["job_name"] = "Default Job"
            pipeline_status["docs"] = 0
            pipeline_status["batchs"] = 0
            pipeline_status["cur_batch"] = 0
            pipeline_status["request_pending"] = False
            pipeline_status["cancellation_requested"] = False

        await run_scanning_process(rag, doc_manager, track_id)

    except Exception as e:
        logger.error(f"Error rebuilding workspace from indexing version: {str(e)}")
        logger.error(traceback.format_exc())
        async with pipeline_status_lock:
            pipeline_status["latest_message"] = (
                f"Workspace rebuild failed: {str(e)}"
            )
            pipeline_status["history_messages"].append(
                f"Workspace rebuild failed: {str(e)}"
            )
            pipeline_status["busy"] = False


# Legacy text extractors moved to lightrag.parser.legacy.extractors; the
# legacy engine now extracts at the worker stage (LegacyParser), not here.


async def _reserve_enqueue_slot(rag: LightRAG) -> bool:
    """Reserve an upload/insert slot before handing work to a background task."""
    from lightrag.kg.shared_storage import (
        get_namespace_data,
        get_namespace_lock,
        initialize_pipeline_status,
    )

    await initialize_pipeline_status(workspace=rag.workspace)
    pipeline_status = await get_namespace_data(
        "pipeline_status", workspace=rag.workspace
    )
    pipeline_status_lock = get_namespace_lock(
        "pipeline_status", workspace=rag.workspace
    )

    async with pipeline_status_lock:
        if pipeline_status.get("scanning_exclusive"):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cannot enqueue while scan is classifying files; "
                    "wait for classification to finish before retrying."
                ),
            )
        if pipeline_status.get("destructive_busy"):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cannot enqueue while pipeline is clearing or deleting "
                    "documents; wait for the running job to finish."
                ),
            )
        pipeline_status["pending_enqueues"] = (
            int(pipeline_status.get("pending_enqueues", 0) or 0) + 1
        )
    return True


async def _release_enqueue_slot(rag: LightRAG) -> None:
    from lightrag.kg.shared_storage import get_namespace_data, get_namespace_lock

    pipeline_status = await get_namespace_data(
        "pipeline_status", workspace=rag.workspace
    )
    pipeline_status_lock = get_namespace_lock(
        "pipeline_status", workspace=rag.workspace
    )

    async with pipeline_status_lock:
        pending = int(pipeline_status.get("pending_enqueues", 0) or 0)
        pipeline_status["pending_enqueues"] = max(0, pending - 1)


async def _run_pipeline_index_file_with_slot(
    rag: LightRAG, file_path: Path, track_id: str
) -> None:
    try:
        await pipeline_index_file(rag, file_path, track_id)
    finally:
        await _release_enqueue_slot(rag)


async def _run_pipeline_index_texts_with_slot(
    rag: LightRAG,
    texts: List[str],
    *,
    file_sources: List[str] | None,
    track_id: str,
) -> None:
    try:
        await pipeline_index_texts(
            rag,
            texts,
            file_sources=file_sources,
            track_id=track_id,
        )
    finally:
        await _release_enqueue_slot(rag)


async def pipeline_enqueue_file(
    rag: LightRAG,
    file_path: Path,
    track_id: str = None,
    from_scan: bool = False,
) -> tuple[bool, str]:
    """Add a file to the queue for processing

    Args:
        rag: LightRAG instance
        file_path: Path to the saved file
        track_id: Optional tracking ID, if not provided will be generated
        from_scan: True only when invoked by the scan-owned background task,
            which already holds ``pipeline_status["scanning"]``.  Forwarded to
            ``apipeline_enqueue_documents`` so the scan can enqueue the files
            it just discovered without tripping the scanning guard there.
    Returns:
        tuple: (success: bool, track_id: str)
    """

    # Generate track_id if not provided
    if track_id is None:
        track_id = generate_track_id("unknown")

    try:
        file_size = 0

        # Get file size for error reporting
        try:
            stat = await asyncio.to_thread(file_path.stat)
            file_size = stat.st_size
        except Exception:
            file_size = 0

        try:
            extraction_engine, process_options = resolve_file_parser_directives(
                file_path
            )
        except FilenameParserHintError as e:
            error_files = [
                {
                    "file_path": str(file_path.name),
                    "error_description": FILE_EXTRACTION_SUMMARY_PREFIX
                    + "Filename hint error",
                    "original_error": str(e),
                    "file_size": file_size,
                }
            ]
            await rag.apipeline_enqueue_error_documents(error_files, track_id)
            logger.error(
                f"[File Extraction]Invalid filename hint in {file_path.name}: {e}"
            )
            return False, track_id

        api_process_options = process_options or PROCESS_OPTION_CHUNK_FIXED
        # All engines defer parsing to the worker stage: the file is already
        # saved on disk, so we enqueue PENDING_PARSE with the chosen engine.
        # Legacy now extracts at the worker (LegacyParser) instead of eagerly
        # here, so every engine shares one ingestion path.
        try:
            enqueue_kwargs = {
                "file_paths": str(file_path),
                "track_id": track_id,
                "docs_format": FULL_DOCS_FORMAT_PENDING_PARSE,
                "parse_engine": extraction_engine,
                "process_options": api_process_options,
                "from_scan": from_scan,
            }
            enqueue_result = await rag.apipeline_enqueue_documents("", **enqueue_kwargs)
            if enqueue_result is None:
                try:
                    await move_file_to_parsed_dir(file_path)
                except Exception as move_error:
                    logger.error(
                        f"Failed to move duplicate file {file_path.name} to {PARSED_DIR_NAME} directory: {move_error}"
                    )
                return False, track_id
            logger.info(
                f"[File Extraction]Deferred {file_path.name} to {extraction_engine} parser"
            )
            return True, track_id
        except Exception as e:
            error_files = [
                {
                    "file_path": str(file_path.name),
                    "error_description": FILE_EXTRACTION_SUMMARY_PREFIX
                    + "Parser enqueue error",
                    "original_error": f"Failed to enqueue file for parser: {str(e)}",
                    "file_size": file_size,
                }
            ]
            await rag.apipeline_enqueue_error_documents(error_files, track_id)
            logger.error(
                f"[File Extraction]Error enqueuing {file_path.name} for {extraction_engine}: {str(e)}"
            )
            return False, track_id

    except Exception as e:
        # Catch-all for any unexpected errors
        try:
            file_size = file_path.stat().st_size if file_path.exists() else 0
        except Exception:
            file_size = 0

        error_files = [
            {
                "file_path": str(file_path.name),
                "error_description": "Unexpected processing error",
                "original_error": f"Unexpected error: {str(e)}",
                "file_size": file_size,
            }
        ]
        await rag.apipeline_enqueue_error_documents(error_files, track_id)
        logger.error(f"Enqueuing file {file_path.name} error: {str(e)}")
        logger.error(traceback.format_exc())
        return False, track_id
    finally:
        if file_path.name.startswith(temp_prefix):
            try:
                file_path.unlink()
            except Exception as e:
                logger.error(f"Error deleting file {file_path}: {str(e)}")


async def pipeline_index_file(
    rag: LightRAG,
    file_path: Path,
    track_id: str = None,
    *,
    from_scan: bool = False,
):
    """Index a file with track_id

    Args:
        rag: LightRAG instance
        file_path: Path to the saved file
        track_id: Optional tracking ID
    """
    try:
        success, returned_track_id = await pipeline_enqueue_file(
            rag, file_path, track_id, from_scan=from_scan
        )
        if success:
            await rag.apipeline_process_enqueue_documents()

    except Exception as e:
        logger.error(f"Error indexing file {file_path.name}: {str(e)}")
        logger.error(traceback.format_exc())


async def pipeline_index_files(
    rag: LightRAG,
    file_paths: List[Path],
    track_id: str = None,
    *,
    from_scan: bool = False,
):
    """Index multiple files sequentially to avoid high CPU load

    Args:
        rag: LightRAG instance
        file_paths: Paths to the files to index
        track_id: Optional tracking ID to pass to all files
    """
    if not file_paths:
        return
    try:
        enqueued = False

        # Use get_pinyin_sort_key for Chinese pinyin sorting
        sorted_file_paths = sorted(
            file_paths, key=lambda p: get_pinyin_sort_key(str(p))
        )

        # Process files sequentially with track_id
        for file_path in sorted_file_paths:
            success, _ = await pipeline_enqueue_file(
                rag, file_path, track_id, from_scan=from_scan
            )
            if success:
                enqueued = True

        # Process the queue only if at least one file was successfully enqueued
        if enqueued:
            await rag.apipeline_process_enqueue_documents()
    except Exception as e:
        logger.error(f"Error indexing files: {str(e)}")
        logger.error(traceback.format_exc())


_STRATEGY_TO_PROCESS_OPTION: Dict[str, str] = {
    "fixed_token": PROCESS_OPTION_CHUNK_FIXED,
    "recursive_character": PROCESS_OPTION_CHUNK_RECURSIVE,
    "semantic_vector": PROCESS_OPTION_CHUNK_VECTOR,
    "paragraph_semantic": PROCESS_OPTION_CHUNK_PARAGRAH,
}


def _resolve_text_chunking(
    chunking: Optional[TextChunkingConfig], rag: LightRAG
) -> tuple[str, dict]:
    """Freeze a ``chunking`` request into ``(process_options, chunk_options)``.

    When ``chunking`` is ``None`` this reproduces today's behavior exactly:
    fixed-token strategy with the snapshot built from
    ``rag.addon_params['chunker']``.

    Otherwise the validated, strategy-specific params are merged into the
    selected strategy's sub-dict. ``chunk_token_size`` rides along inside
    ``params`` like any other key — every strategy (F included, after the
    ``process_single_document`` cleanup) reads its size from its own
    sub-dict, with the top-level snapshot value as the shared fallback.

    Raises:
        ValueError: when the request lowers ``chunk_token_size`` below the
            *effective* ``chunk_overlap_token_size``.  The overlap is often
            inherited from ``addon_params``/env (the overlay fills
            ``fixed_token``/``recursive_character``/``paragraph_semantic``
            overlap with ``CHUNK_*_OVERLAP_SIZE`` / ``CHUNK_OVERLAP_SIZE``),
            so this can only be checked here against the resolved snapshot,
            not in the request model.  Callers on the request path invoke
            this synchronously so the failure surfaces as HTTP 422 before any
            background work is scheduled.
    """
    if chunking is None:
        # No request-driven config: reproduce today's behavior verbatim,
        # including not introducing new validation on the default path.
        process_options = PROCESS_OPTION_CHUNK_FIXED
        return process_options, resolve_chunk_options(
            rag.addon_params, process_options=process_options
        )

    process_options = _STRATEGY_TO_PROCESS_OPTION[chunking.strategy]
    chunk_options = resolve_chunk_options(
        rag.addon_params, process_options=process_options
    )
    strategy_key = chunk_strategy_key(process_options)
    chunk_options[strategy_key].update(chunking.params)
    _validate_effective_chunk_overlap(chunk_options, strategy_key, chunking.strategy)
    _validate_effective_semantic_amount(chunk_options, strategy_key)
    return process_options, chunk_options


def _validate_effective_chunk_overlap(
    chunk_options: dict, strategy_key: str, strategy_name: str
) -> None:
    """Reject a resolved snapshot whose overlap is >= its chunk size.

    Operates on the fully-resolved ``chunk_options`` so it catches the case
    the request model cannot: ``chunk_token_size`` supplied in the request
    while ``chunk_overlap_token_size`` is inherited from addon_params/env
    (e.g. ``chunk_token_size=50`` with the default overlap ``100``).  The
    effective size is the strategy sub-dict value, falling back to the
    top-level snapshot size; the effective overlap is the sub-dict value
    (``semantic_vector`` carries none, so it is skipped).
    """
    sub = chunk_options.get(strategy_key) or {}
    # Fixed-token delimiter-only mode (split_by_character set AND
    # split_by_character_only=True) never applies overlap:
    # chunking_by_token_size only validates each delimiter segment against
    # chunk_token_size and raises on an oversize segment — the overlap field
    # is unused. Enforcing overlap < size there would wrongly 422 a valid
    # request such as paragraph splitting with a small chunk_token_size.
    # (split_by_character_only is itself a no-op when split_by_character is
    # falsy, so both must be effective for overlap to be skipped.)
    if (
        strategy_key == "fixed_token"
        and sub.get("split_by_character")
        and sub.get("split_by_character_only")
    ):
        return
    overlap = sub.get("chunk_overlap_token_size")
    if overlap is None:
        return
    size = sub.get("chunk_token_size")
    if size is None:
        size = chunk_options.get("chunk_token_size")
    if size is not None and overlap >= size:
        raise ValueError(
            f"chunking for strategy '{strategy_name}': effective "
            f"chunk_overlap_token_size ({overlap}) must be < chunk_token_size "
            f"({size}). The overlap is inherited from addon_params/env when "
            f"not set in the request; raise chunk_token_size or lower "
            f"chunk_overlap_token_size."
        )


def _validate_effective_semantic_amount(chunk_options: dict, strategy_key: str) -> None:
    """Reject a resolved semantic_vector snapshot whose breakpoint amount
    exceeds the percentile/gradient ceiling.

    Uses the *effective* ``breakpoint_threshold_type`` from the merged
    snapshot — the request model cannot, because the type may be inherited
    from ``addon_params``/``CHUNK_V_BREAKPOINT_THRESHOLD_TYPE`` while the
    request overrides only ``breakpoint_threshold_amount``. ``percentile`` /
    ``gradient`` feed ``np.percentile`` (q must be in ``[0, 100]``);
    ``standard_deviation`` / ``interquartile`` are multipliers with no upper
    bound, so a request amount > 100 is valid for them.
    """
    if strategy_key != "semantic_vector":
        return
    sub = chunk_options.get(strategy_key) or {}
    amt = sub.get("breakpoint_threshold_amount")
    if amt is None:
        return
    kind = sub.get("breakpoint_threshold_type") or "percentile"
    if kind in ("percentile", "gradient") and amt > 100:
        raise ValueError(
            f"chunking for strategy 'semantic_vector': "
            f"breakpoint_threshold_amount ({amt}) must be within (0, 100] for "
            f"breakpoint_threshold_type '{kind}'. The type is inherited from "
            f"addon_params/env when not set in the request."
        )


async def pipeline_index_texts(
    rag: LightRAG,
    texts: List[str],
    file_sources: List[str] = None,
    track_id: str = None,
    chunking: Optional[TextChunkingConfig] = None,
):
    """Index a list of texts with track_id

    Args:
        rag: LightRAG instance
        texts: The texts to index
        file_sources: Sources of the texts
        track_id: Optional tracking ID
        chunking: Optional chunking strategy + params (already validated by
            the request model); when None, default fixed-token chunking is used
    """
    if not texts:
        return

    normalized_file_sources: list[str] | None = None
    if file_sources:
        normalized_file_sources = [
            normalize_document_file_path(source) for source in file_sources
        ]
        if any(source == UNKNOWN_FILE_SOURCE for source in normalized_file_sources):
            raise ValueError("Each text must provide a valid file source")
        if len(normalized_file_sources) > len(texts):
            raise ValueError("Number of file sources must not exceed number of texts")
        if len(normalized_file_sources) < len(texts):
            normalized_file_sources.extend(
                [UNKNOWN_FILE_SOURCE] * (len(texts) - len(normalized_file_sources))
            )

    process_options, chunk_options = _resolve_text_chunking(chunking, rag)
    await rag.apipeline_enqueue_documents(
        input=texts,
        file_paths=normalized_file_sources,
        track_id=track_id,
        process_options=process_options,
        chunk_options=chunk_options,
    )
    await rag.apipeline_process_enqueue_documents()


async def run_scanning_process(
    rag: LightRAG, doc_manager: DocumentManager, track_id: str = None
):
    """Background task to scan and index documents

    Args:
        rag: LightRAG instance
        doc_manager: DocumentManager instance
        track_id: Optional tracking ID to pass to all scanned files
    """
    from lightrag.kg.shared_storage import (
        get_namespace_data,
        get_namespace_lock,
        initialize_pipeline_status,
    )

    await initialize_pipeline_status(workspace=rag.workspace)
    pipeline_status = await get_namespace_data(
        "pipeline_status", workspace=rag.workspace
    )
    pipeline_status_lock = get_namespace_lock(
        "pipeline_status", workspace=rag.workspace
    )

    async def _find_existing_doc(file_path: Path):
        candidates = [
            str(file_path),
            file_path.name,
            normalize_document_file_path(file_path.name),
        ]
        seen_candidates: set[str] = set()
        for candidate in candidates:
            if candidate in seen_candidates:
                continue
            seen_candidates.add(candidate)
            existing = await rag.doc_status.get_doc_by_file_path(candidate)
            if existing:
                return candidate, existing

        if hasattr(rag.doc_status, "get_doc_by_file_basename"):
            match = await rag.doc_status.get_doc_by_file_basename(
                normalize_document_file_path(file_path.name)
            )
            if match:
                return match
        return None

    def _status_value(doc: dict[str, Any]) -> str:
        status = doc.get("status", "")
        if hasattr(status, "value"):
            status = status.value
        return str(status).lower()

    try:
        async with pipeline_status_lock:
            pipeline_status["scanning"] = True
            pipeline_status["scanning_exclusive"] = True
            pipeline_status["scan_is_scanning"] = True
            pipeline_status["scan_indexed_count"] = 0
            pipeline_status["scan_current_file"] = ""

        new_files = doc_manager.scan_directory_for_new_files()
        total_files = len(new_files)
        logger.info(f"Found {total_files} files to index.")

        valid_files: list[Path] = []
        resume_needed = False
        files_by_canonical: dict[str, list[Path]] = {}

        for file_path in new_files:
            files_by_canonical.setdefault(
                normalize_document_file_path(file_path.name), []
            ).append(file_path)

        for canonical_name, file_group in files_by_canonical.items():
            selected = file_group[0]
            if len(file_group) > 1:
                selected = next(
                    (
                        path
                        for path in file_group
                        if normalize_document_file_path(path.name) != path.name
                    ),
                    file_group[0],
                )
                for duplicate in file_group:
                    if duplicate != selected:
                        await move_file_to_parsed_dir(duplicate)

            existing_match = await _find_existing_doc(selected)
            if existing_match:
                doc_id, existing_doc_data = existing_match
                status = _status_value(existing_doc_data)
                if status == DocStatus.PROCESSED.value:
                    await move_file_to_parsed_dir(selected)
                    logger.warning(f"Skipping already processed file: {selected.name}")
                    continue
                if status == DocStatus.FAILED.value:
                    full_doc = None
                    if hasattr(rag, "full_docs"):
                        full_doc = await rag.full_docs.get_by_id(doc_id)
                    if full_doc is None:
                        await rag.doc_status.delete([doc_id])
                        valid_files.append(selected)
                        continue
                resume_needed = True
                continue

            # Canonical duplicate found through another name in the same scan.
            if canonical_name != normalize_document_file_path(selected.name):
                await move_file_to_parsed_dir(selected)
                continue
            valid_files.append(selected)

        async with pipeline_status_lock:
            pipeline_status["scan_total_files"] = len(valid_files)
            pipeline_status["scanning_exclusive"] = False

        if valid_files:
            await pipeline_index_files(
                rag, valid_files, track_id, from_scan=True
            )

        if resume_needed or not new_files:
            await rag.apipeline_process_enqueue_documents()

        logger.info(f"Scanning process completed: {len(valid_files)} files queued.")

    except Exception as e:
        logger.error(f"Error during scanning process: {str(e)}")
        logger.error(traceback.format_exc())
    finally:
        async with pipeline_status_lock:
            pipeline_status["scanning"] = False
            pipeline_status["scanning_exclusive"] = False
            pipeline_status["scan_is_scanning"] = False
            pipeline_status["scan_current_file"] = ""


async def background_delete_documents(
    rag: LightRAG,
    doc_manager: DocumentManager,
    doc_ids: List[str],
    delete_file: bool = False,
    delete_llm_cache: bool = False,
):
    """Background task to delete multiple documents"""
    from lightrag.kg.shared_storage import (
        get_namespace_data,
        get_namespace_lock,
    )

    pipeline_status = await get_namespace_data(
        "pipeline_status", workspace=rag.workspace
    )
    pipeline_status_lock = get_namespace_lock(
        "pipeline_status", workspace=rag.workspace
    )

    total_docs = len(doc_ids)
    successful_deletions = []
    failed_deletions = []

    # Double-check pipeline status before proceeding
    async with pipeline_status_lock:
        if pipeline_status.get("busy", False) and not pipeline_status.get(
            "destructive_busy", False
        ):
            logger.warning("Error: Unexpected pipeline busy state, aborting deletion.")
            return  # Abort deletion operation

        # Set pipeline status to busy for deletion
        pipeline_status.update(
            {
                "busy": True,
                # Job name can not be changed, it's verified in adelete_by_doc_id()
                "job_name": f"Deleting {total_docs} Documents",
                "job_start": datetime.now().isoformat(),
                "docs": total_docs,
                "batchs": total_docs,
                "cur_batch": 0,
                "latest_message": "Starting document deletion process",
                "destructive_busy": True,
            }
        )
        # Use slice assignment to clear the list in place
        pipeline_status["history_messages"][:] = ["Starting document deletion process"]
        if delete_llm_cache:
            pipeline_status["history_messages"].append(
                "LLM cache cleanup requested for this deletion job"
            )

    try:
        # Loop through each document ID and delete them one by one
        for i, doc_id in enumerate(doc_ids, 1):
            # Check for cancellation at the start of each document deletion
            async with pipeline_status_lock:
                if pipeline_status.get("cancellation_requested", False):
                    cancel_msg = f"Deletion cancelled by user at document {i}/{total_docs}. {len(successful_deletions)} deleted, {total_docs - i + 1} remaining."
                    logger.info(cancel_msg)
                    pipeline_status["latest_message"] = cancel_msg
                    pipeline_status["history_messages"].append(cancel_msg)
                    # Add remaining documents to failed list with cancellation reason
                    failed_deletions.extend(
                        doc_ids[i - 1 :]
                    )  # i-1 because enumerate starts at 1
                    break  # Exit the loop, remaining documents unchanged

                start_msg = f"Deleting document {i}/{total_docs}: {doc_id}"
                logger.info(start_msg)
                pipeline_status["cur_batch"] = i
                pipeline_status["latest_message"] = start_msg
                pipeline_status["history_messages"].append(start_msg)

            file_path = "#"
            try:
                result = await rag.adelete_by_doc_id(
                    doc_id, delete_llm_cache=delete_llm_cache
                )
                file_path = (
                    getattr(result, "file_path", "-") if "result" in locals() else "-"
                )
                if result.status == "success":
                    successful_deletions.append(doc_id)
                    success_msg = (
                        f"Document deleted {i}/{total_docs}: {doc_id}[{file_path}]"
                    )
                    logger.info(success_msg)
                    async with pipeline_status_lock:
                        pipeline_status["history_messages"].append(success_msg)

                    # Handle file deletion if requested and file_path is available
                    if (
                        delete_file
                        and result.file_path
                        and result.file_path != "unknown_source"
                    ):
                        try:
                            deleted_files, deletion_errors = (
                                delete_file_variants_by_file_path(
                                    doc_manager.input_dir, result.file_path
                                )
                            )
                            for deleted_file in deleted_files:
                                file_delete_msg = (
                                    f"Successfully deleted input_dir file: {deleted_file}"
                                )
                                logger.info(file_delete_msg)
                                async with pipeline_status_lock:
                                    pipeline_status["latest_message"] = file_delete_msg
                                    pipeline_status["history_messages"].append(
                                        file_delete_msg
                                    )

                            for deletion_error in deletion_errors:
                                file_error_msg = (
                                    f"Failed to delete file variant {deletion_error}"
                                )
                                logger.warning(file_error_msg)
                                async with pipeline_status_lock:
                                    pipeline_status["latest_message"] = file_error_msg
                                    pipeline_status["history_messages"].append(
                                        file_error_msg
                                    )

                            if deleted_files == []:
                                file_error_msg = f"File deletion skipped, missing or unsafe file: {result.file_path}"
                                logger.warning(file_error_msg)
                                async with pipeline_status_lock:
                                    pipeline_status["latest_message"] = file_error_msg
                                    pipeline_status["history_messages"].append(
                                        file_error_msg
                                    )

                        except Exception as file_error:
                            file_error_msg = f"Failed to delete file {result.file_path}: {str(file_error)}"
                            logger.error(file_error_msg)
                            async with pipeline_status_lock:
                                pipeline_status["latest_message"] = file_error_msg
                                pipeline_status["history_messages"].append(
                                    file_error_msg
                                )
                    elif delete_file:
                        no_file_msg = (
                            f"File deletion skipped, missing file path: {doc_id}"
                        )
                        logger.warning(no_file_msg)
                        async with pipeline_status_lock:
                            pipeline_status["latest_message"] = no_file_msg
                            pipeline_status["history_messages"].append(no_file_msg)
                else:
                    failed_deletions.append(doc_id)
                    error_msg = f"Failed to delete {i}/{total_docs}: {doc_id}[{file_path}] - {result.message}"
                    logger.error(error_msg)
                    async with pipeline_status_lock:
                        pipeline_status["latest_message"] = error_msg
                        pipeline_status["history_messages"].append(error_msg)

            except Exception as e:
                failed_deletions.append(doc_id)
                error_msg = f"Error deleting document {i}/{total_docs}: {doc_id}[{file_path}] - {str(e)}"
                logger.error(error_msg)
                logger.error(traceback.format_exc())
                async with pipeline_status_lock:
                    pipeline_status["latest_message"] = error_msg
                    pipeline_status["history_messages"].append(error_msg)

    except Exception as e:
        error_msg = f"Critical error during batch deletion: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        async with pipeline_status_lock:
            pipeline_status["history_messages"].append(error_msg)
    finally:
        # Final summary and check for pending requests
        async with pipeline_status_lock:
            pipeline_status["busy"] = False
            pipeline_status["destructive_busy"] = False
            pipeline_status["pending_requests"] = False  # Reset pending requests flag
            pipeline_status["cancellation_requested"] = (
                False  # Always reset cancellation flag
            )
            completion_msg = f"Deletion completed: {len(successful_deletions)} successful, {len(failed_deletions)} failed"
            pipeline_status["latest_message"] = completion_msg
            pipeline_status["history_messages"].append(completion_msg)

            # Check if there are pending document indexing requests
            has_pending_request = pipeline_status.get("request_pending", False)

        # If there are pending requests, start document processing pipeline
        if has_pending_request:
            try:
                logger.info(
                    "Processing pending document indexing requests after deletion"
                )
                await rag.apipeline_process_enqueue_documents()
            except Exception as e:
                logger.error(f"Error processing pending documents after deletion: {e}")


def create_document_routes(
    rag: LightRAG, doc_manager: DocumentManager, api_key: Optional[str] = None
):
    # Fresh router per call — see the note above the temp_prefix constant.
    router = APIRouter(
        prefix="/documents",
        tags=["documents"],
    )

    # Create combined auth dependency for document routes
    combined_auth = get_combined_auth_dependency(api_key)

    def _current_runtime_objects() -> tuple[LightRAG, DocumentManager]:
        runtime = get_current_runtime()
        if runtime is None:
            return rag, doc_manager
        return runtime.rag, runtime.doc_manager

    @router.post(
        "/rebuild_from_indexing_version",
        response_model=RebuildDocumentsResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def rebuild_from_indexing_version(
        request: RebuildFromIndexingVersionRequest, background_tasks: BackgroundTasks
    ):
        from lightrag.kg.shared_storage import (
            get_namespace_data,
            get_namespace_lock,
        )

        current_rag, current_doc_manager = _current_runtime_objects()
        pipeline_status = await get_namespace_data(
            "pipeline_status", workspace=current_rag.workspace
        )
        pipeline_status_lock = get_namespace_lock(
            "pipeline_status", workspace=current_rag.workspace
        )

        async with pipeline_status_lock:
            if pipeline_status.get("busy", False):
                return RebuildDocumentsResponse(
                    status="busy",
                    message="Cannot rebuild documents while pipeline is busy",
                    track_id="",
                )

        try:
            # Prompt version activation retired — local prompt management removed
            pass
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        track_id = generate_track_id("rebuild")
        background_tasks.add_task(
            background_rebuild_documents_from_indexing_version,
            current_rag,
            current_doc_manager,
            request.version_id,
            track_id,
        )
        return RebuildDocumentsResponse(
            status="rebuild_started",
            message="Workspace rebuild has been initiated in the background.",
            track_id=track_id,
        )

    @router.post(
        "/scan", response_model=ScanResponse, dependencies=[Depends(combined_auth)]
    )
    async def scan_for_new_documents(background_tasks: BackgroundTasks):
        """
        Trigger the scanning process for new documents.

        This endpoint initiates a background task that scans the input directory for new documents
        and processes them. If a scanning process is already running, it returns a status indicating
        that fact.

        Returns:
            ScanResponse: A response object containing the scanning status and track_id
        """
        # Generate track_id with "scan" prefix for scanning operation
        track_id = generate_track_id("scan")
        current_rag, current_doc_manager = _current_runtime_objects()
        from lightrag.kg.shared_storage import get_namespace_data, get_namespace_lock

        pipeline_status = await get_namespace_data(
            "pipeline_status", workspace=current_rag.workspace
        )
        pipeline_status_lock = get_namespace_lock(
            "pipeline_status", workspace=current_rag.workspace
        )

        async with pipeline_status_lock:
            if (
                pipeline_status.get("busy")
                or pipeline_status.get("scanning")
                or int(pipeline_status.get("pending_enqueues", 0) or 0) > 0
            ):
                return ScanResponse(
                    status="scanning_skipped_pipeline_busy",
                    message="Scanning skipped because pipeline is busy",
                    track_id=track_id,
                )
            pipeline_status["scanning"] = True

        # Start the scanning process in the background with track_id
        background_tasks.add_task(
            run_scanning_process, current_rag, current_doc_manager, track_id
        )
        return ScanResponse(
            status="scanning_started",
            message="Scanning process has been initiated in the background",
            track_id=track_id,
        )

    @router.post(
        "/upload", response_model=InsertResponse, dependencies=[Depends(combined_auth)]
    )
    async def upload_to_input_dir(
        background_tasks: BackgroundTasks, file: UploadFile = File(...)
    ):
        """
        Upload a file to the input directory and index it.

        This API endpoint accepts a file through an HTTP POST request, checks if the
        uploaded file is of a supported type, saves it in the specified input directory,
        indexes it for retrieval, and returns a success status with relevant details.

        **File Size Limit:**
        - Configurable via `MAX_UPLOAD_SIZE` environment variable (default: 100MB)
        - Set to `None` or `0` for unlimited upload size
        - Returns HTTP 413 (Request Entity Too Large) if file exceeds limit

        **Duplicate Detection Behavior:**

        This endpoint handles two types of duplicate scenarios differently:

        1. **Filename Duplicate (Synchronous Detection)**:
           - Detected immediately before file processing
           - Returns `status="duplicated"` with the existing document's track_id
           - Two cases:
             - If filename exists in document storage: returns existing track_id
             - If filename exists in file system only: returns empty track_id ("")

        2. **Content Duplicate (Asynchronous Detection)**:
           - Detected during background processing after content extraction
           - Returns `status="success"` with a new track_id immediately
           - The duplicate is detected later when processing the file content
           - Use `/documents/track_status/{track_id}` to check the final result:
             - Document will have `status="FAILED"`
             - `error_msg` contains "Content already exists. Original doc_id: xxx"
             - `metadata.is_duplicate=true` with reference to original document
             - `metadata.original_doc_id` points to the existing document
             - `metadata.original_track_id` shows the original upload's track_id

        **Why Different Behavior?**
        - Filename check is fast (simple lookup), done synchronously
        - Content extraction is expensive (PDF/DOCX parsing), done asynchronously
        - This design prevents blocking the client during expensive operations

        Args:
            background_tasks: FastAPI BackgroundTasks for async processing
            file (UploadFile): The file to be uploaded. It must have an allowed extension.

        Returns:
            InsertResponse: A response object containing the upload status and a message.
                - status="success": File accepted and queued for processing
                - status="duplicated": Filename already exists (see track_id for existing document)

        Raises:
            HTTPException: If the file type is not supported (400), file too large (413), or other errors occur (500).
        """
        reserved_enqueue = False
        current_rag = None
        try:
            current_rag, current_doc_manager = _current_runtime_objects()
            # Sanitize filename to prevent Path Traversal attacks
            safe_filename = sanitize_filename(file.filename, current_doc_manager.input_dir)
            canonical_filename = normalize_document_file_path(safe_filename)

            try:
                filename_supported = current_doc_manager.is_supported_file(
                    safe_filename
                )
            except FilenameParserHintError as hint_error:
                # Reject malformed hints synchronously with the detailed
                # message (previously surfaced asynchronously as an error
                # document after the upload was accepted).
                raise HTTPException(status_code=400, detail=str(hint_error))
            if not filename_supported:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type. Supported types: {current_doc_manager.supported_extensions}",
                )

            # Check file size limit (if configured)
            if (
                global_args.max_upload_size is not None
                and global_args.max_upload_size > 0
            ):
                # Safe access to file size (not available in older Starlette versions)
                file_size = getattr(file, "size", None)

                # Pre-flight size check (only if size is available)
                if file_size is not None:
                    if file_size > global_args.max_upload_size:
                        raise HTTPException(
                            status_code=413,
                            detail=f"File too large. Maximum size: {global_args.max_upload_size / 1024 / 1024:.1f}MB, uploaded: {file_size / 1024 / 1024:.1f}MB",
                        )
                else:
                    # If size not available, we'll check during streaming
                    logger.debug(
                        f"File size not available in UploadFile for {safe_filename}, will check during streaming"
                    )

            # Check if filename already exists in doc_status storage
            existing_doc_data = await current_rag.doc_status.get_doc_by_file_path(
                safe_filename
            )
            if not existing_doc_data and canonical_filename != safe_filename:
                existing_doc_data = await current_rag.doc_status.get_doc_by_file_path(
                    canonical_filename
                )
            if existing_doc_data:
                # Get document status and track_id from existing document
                status = existing_doc_data.get("status", "unknown")
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"File '{canonical_filename}' already exists in document "
                        f"storage (Status: {status})."
                    ),
                )

            file_path = current_doc_manager.input_dir / safe_filename
            canonical_file_path = current_doc_manager.input_dir / canonical_filename
            # Check if file already exists in file system
            if file_path.exists() or (
                canonical_file_path != file_path and canonical_file_path.exists()
            ):
                raise HTTPException(
                    status_code=409,
                    detail=f"File '{canonical_filename}' already exists in the input directory.",
                )

            await _reserve_enqueue_slot(current_rag)
            reserved_enqueue = True

            # Async streaming write with size check
            bytes_written = 0
            chunk_size = 1024 * 1024  # 1MB chunks
            needs_cleanup = False

            async with aiofiles.open(file_path, "wb") as out_file:
                while True:
                    # Read chunk from upload stream
                    chunk = await file.read(chunk_size)
                    if not chunk:
                        break

                    # Check size limit during streaming (if not checked before)
                    if (
                        global_args.max_upload_size is not None
                        and global_args.max_upload_size > 0
                    ):
                        bytes_written += len(chunk)
                        if bytes_written > global_args.max_upload_size:
                            needs_cleanup = True
                            break

                    # Write chunk to file
                    await out_file.write(chunk)

            # Cleanup after file is closed
            if needs_cleanup:
                try:
                    file_path.unlink()
                except Exception as cleanup_error:
                    logger.error(
                        f"Error cleaning up oversized file {safe_filename}: {cleanup_error}"
                    )

                raise HTTPException(
                    status_code=413,
                    detail=f"File too large. Maximum size: {global_args.max_upload_size / 1024 / 1024:.1f}MB, uploaded: {bytes_written / 1024 / 1024:.1f}MB",
                )

            track_id = generate_track_id("upload")

            # Add to background tasks and get track_id
            background_tasks.add_task(
                _run_pipeline_index_file_with_slot,
                current_rag,
                file_path,
                track_id,
            )
            reserved_enqueue = False

            return InsertResponse(
                status="success",
                message=f"File '{safe_filename}' uploaded successfully. Processing will continue in background.",
                track_id=track_id,
            )

        except HTTPException:
            if reserved_enqueue and current_rag is not None:
                await _release_enqueue_slot(current_rag)
            # Re-raise HTTP exceptions (400, 413, etc.)
            raise
        except Exception as e:
            if reserved_enqueue and current_rag is not None:
                await _release_enqueue_slot(current_rag)
            logger.error(f"Error /documents/upload: {file.filename}: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/text", response_model=InsertResponse, dependencies=[Depends(combined_auth)]
    )
    async def insert_text(
        request: InsertTextRequest, background_tasks: BackgroundTasks
    ):
        """
        Insert text into the RAG system.

        This endpoint allows you to insert text data into the RAG system for later retrieval
        and use in generating responses.

        Args:
            request (InsertTextRequest): The request body containing the text to be inserted.
            background_tasks: FastAPI BackgroundTasks for async processing

        Returns:
            InsertResponse: A response object containing the status of the operation.

        Raises:
            HTTPException: If an error occurs during text processing (500).
        """
        current_rag: LightRAG | None = None
        slot_reserved = False
        try:
            current_rag, _ = _current_runtime_objects()
            slot_reserved = await _reserve_enqueue_slot(current_rag)

            # Check if file_source already exists in doc_status storage
            if (
                request.file_source
                and request.file_source.strip()
                and request.file_source != UNKNOWN_FILE_SOURCE
            ):
                existing_doc_data = await _get_existing_doc_by_file_source(
                    current_rag.doc_status, request.file_source
                )
                if existing_doc_data:
                    # Get document status and track_id from existing document
                    status = doc_status_field(existing_doc_data, "status", "unknown")
                    # Use `or ""` to handle both missing key and None value (e.g., legacy rows without track_id)
                    existing_track_id = (
                        doc_status_field(existing_doc_data, "track_id", "") or ""
                    )
                    return InsertResponse(
                        status="duplicated",
                        message=f"File source '{request.file_source}' already exists in document storage (Status: {status}).",
                        track_id=existing_track_id,
                    )

            # Check if content already exists by computing content hash (doc_id)
            sanitized_text = sanitize_text_for_encoding(request.text)
            content_doc_id = compute_mdhash_id(sanitized_text, prefix="doc-")
            existing_doc = await _get_doc_status_by_id(
                current_rag.doc_status, content_doc_id
            )
            if existing_doc:
                # Content already exists, return duplicated with existing track_id
                status = doc_status_field(existing_doc, "status", "unknown")
                existing_track_id = doc_status_field(existing_doc, "track_id", "") or ""
                return InsertResponse(
                    status="duplicated",
                    message=f"Identical content already exists in document storage (doc_id: {content_doc_id}, Status: {status}).",
                    track_id=existing_track_id,
                )

            # Resolve + validate chunking synchronously so an invalid
            # effective config (e.g. chunk_token_size below the inherited
            # overlap) fails with HTTP 422 here, before any background work is
            # scheduled. pipeline_index_texts re-resolves from the same
            # addon_params inside the task.
            try:
                _resolve_text_chunking(request.chunking, current_rag)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))

            # Generate track_id for text insertion
            track_id = generate_track_id("insert")

            async def _indexing_task():
                try:
                    await pipeline_index_texts(
                        current_rag,
                        [request.text],
                        file_sources=[request.file_source],
                        track_id=track_id,
                        chunking=request.chunking,
                    )
                finally:
                    await _release_enqueue_slot(current_rag)

            background_tasks.add_task(_indexing_task)
            slot_reserved = False

            return InsertResponse(
                status="success",
                message="Text successfully received. Processing will continue in background.",
                track_id=track_id,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error /documents/text: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if slot_reserved and current_rag is not None:
                await _release_enqueue_slot(current_rag)

    @router.post(
        "/texts",
        response_model=InsertResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def insert_texts(
        request: InsertTextsRequest, background_tasks: BackgroundTasks
    ):
        """
        Insert multiple texts into the RAG system.

        This endpoint allows you to insert multiple text entries into the RAG system
        in a single request.

        Args:
            request (InsertTextsRequest): The request body containing the list of texts.
            background_tasks: FastAPI BackgroundTasks for async processing

        Returns:
            InsertResponse: A response object containing the status of the operation.

        Raises:
            HTTPException: If an error occurs during text processing (500).
        """
        current_rag: LightRAG | None = None
        slot_reserved = False
        try:
            current_rag, _ = _current_runtime_objects()
            slot_reserved = await _reserve_enqueue_slot(current_rag)

            # Check if any file_sources already exist in doc_status storage
            if request.file_sources:
                for file_source in request.file_sources:
                    if (
                        file_source
                        and file_source.strip()
                        and file_source != UNKNOWN_FILE_SOURCE
                    ):
                        existing_doc_data = await _get_existing_doc_by_file_source(
                            current_rag.doc_status, file_source
                        )
                        if existing_doc_data:
                            # Get document status and track_id from existing document
                            status = doc_status_field(
                                existing_doc_data, "status", "unknown"
                            )
                            # Use `or ""` to handle both missing key and None value (e.g., legacy rows without track_id)
                            existing_track_id = (
                                doc_status_field(existing_doc_data, "track_id", "")
                                or ""
                            )
                            return InsertResponse(
                                status="duplicated",
                                message=f"File source '{file_source}' already exists in document storage (Status: {status}).",
                                track_id=existing_track_id,
                            )

            # Check if any content already exists by computing content hash (doc_id)
            for text in request.texts:
                sanitized_text = sanitize_text_for_encoding(text)
                content_doc_id = compute_mdhash_id(sanitized_text, prefix="doc-")
                existing_doc = await _get_doc_status_by_id(
                    current_rag.doc_status, content_doc_id
                )
                if existing_doc:
                    # Content already exists, return duplicated with existing track_id
                    status = doc_status_field(existing_doc, "status", "unknown")
                    existing_track_id = (
                        doc_status_field(existing_doc, "track_id", "") or ""
                    )
                    return InsertResponse(
                        status="duplicated",
                        message=f"Identical content already exists in document storage (doc_id: {content_doc_id}, Status: {status}).",
                        track_id=existing_track_id,
                    )

            # Resolve + validate the shared chunking synchronously so an
            # invalid effective config (e.g. chunk_token_size below the
            # inherited overlap) fails with HTTP 422 here, before any
            # background work is scheduled. pipeline_index_texts re-resolves
            # from the same addon_params inside the task.
            try:
                _resolve_text_chunking(request.chunking, current_rag)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))

            # Generate track_id for texts insertion
            track_id = generate_track_id("insert")

            async def _indexing_task():
                try:
                    await pipeline_index_texts(
                        current_rag,
                        request.texts,
                        file_sources=request.file_sources,
                        track_id=track_id,
                        chunking=request.chunking,
                    )
                finally:
                    await _release_enqueue_slot(current_rag)

            background_tasks.add_task(_indexing_task)
            slot_reserved = False

            return InsertResponse(
                status="success",
                message="Texts successfully received. Processing will continue in background.",
                track_id=track_id,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error /documents/texts: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if slot_reserved and current_rag is not None:
                await _release_enqueue_slot(current_rag)

    @router.post(
        "/rebuild_custom_chunks_graph",
        response_model=CustomChunksGraphRebuildResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def rebuild_custom_chunks_graph(
        background_tasks: BackgroundTasks,
        request: Optional[RebuildGraphsRequest] = None,
    ):
        try:
            from lightrag.kg.shared_storage import (
                get_namespace_data,
                get_namespace_lock,
            )

            current_rag, _ = _current_runtime_objects()
            workspace = getattr(current_rag, "workspace", "")
            pipeline_status = await get_namespace_data(
                "pipeline_status", workspace=workspace
            )
            pipeline_status_lock = get_namespace_lock(
                "pipeline_status", workspace=workspace
            )

            async with pipeline_status_lock:
                if pipeline_status.get("busy", False):
                    return CustomChunksGraphRebuildResponse(
                        status="busy",
                        message="Cannot rebuild custom chunk graphs while pipeline is busy.",
                    )

            background_tasks.add_task(
                current_rag.arebuild_all_custom_chunks_graphs,
                request.doc_ids if request and request.doc_ids else None,
            )
            return CustomChunksGraphRebuildResponse(
                status="rebuild_started",
                message="Custom chunk graph rebuild has been initiated in the background.",
            )
        except Exception as e:
            logger.error(f"Error /documents/rebuild_custom_chunks_graph: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/import/custom-chunks",
        response_model=CustomChunksImportResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def import_custom_chunks(request: CustomChunksImportRequest):
        try:
            current_rag, _ = _current_runtime_objects()
            doc_id = await current_rag.ainsert_custom_chunks(
                request.full_text,
                request.text_chunks,
                request.doc_id,
                request.file_path,
            )
            return CustomChunksImportResponse(
                status="success",
                message="Custom chunks imported successfully.",
                doc_id=doc_id or request.doc_id,
                requested_chunk_count=len(request.text_chunks),
            )
        except Exception as e:
            mapped_error = _map_custom_chunks_import_error(e)
            if mapped_error is not None:
                raise mapped_error
            logger.error(f"Error /documents/import/custom-chunks: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/by-ids",
        response_model=DocumentsByIdsResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def get_documents_by_ids(request: DocumentsByIdsRequest):
        try:
            current_rag, _ = _current_runtime_objects()
            docs_by_ids = await current_rag.aget_docs_by_ids(request.doc_ids)

            documents: list[DocStatusResponse] = []
            missing_doc_ids: list[str] = []
            for doc_id in request.doc_ids:
                doc_status = docs_by_ids.get(doc_id)
                if doc_status is None:
                    missing_doc_ids.append(doc_id)
                    continue
                documents.append(_to_doc_status_response(doc_id, doc_status))

            return DocumentsByIdsResponse(
                documents=documents,
                requested_count=len(request.doc_ids),
                found_count=len(documents),
                missing_doc_ids=missing_doc_ids,
            )
        except Exception as e:
            logger.error(f"Error /documents/by-ids: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/{doc_id:path}/chunks",
        response_model=DocumentChunksResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def get_document_chunks(doc_id: str) -> DocumentChunksResponse:
        try:
            normalized_doc_id = doc_id.strip()
            if not normalized_doc_id:
                raise HTTPException(status_code=400, detail="Document ID cannot be empty")

            current_rag, _ = _current_runtime_objects()
            doc_status = await current_rag.doc_status.get_by_id(normalized_doc_id)
            if doc_status is None:
                raise HTTPException(status_code=404, detail="Document not found")

            raw_chunks_list = (
                doc_status.get("chunks_list", [])
                if isinstance(doc_status, dict)
                else getattr(doc_status, "chunks_list", [])
            )
            chunk_ids = [
                chunk_id.strip()
                for chunk_id in (raw_chunks_list or [])
                if isinstance(chunk_id, str) and chunk_id.strip()
            ]
            if not chunk_ids:
                return DocumentChunksResponse(
                    doc_id=normalized_doc_id,
                    chunk_count=0,
                    chunks=[],
                )

            chunk_payloads = await current_rag.text_chunks.get_by_ids(chunk_ids)
            chunks: list[DocumentChunkResponse] = []
            for fallback_order, (chunk_id, chunk_data) in enumerate(
                zip(chunk_ids, chunk_payloads)
            ):
                if not isinstance(chunk_data, dict):
                    continue

                content = chunk_data.get("content")
                if not isinstance(content, str):
                    continue

                tokens = chunk_data.get("tokens")
                order = chunk_data.get("chunk_order_index")
                chunks.append(
                    DocumentChunkResponse(
                        id=chunk_id,
                        content=content,
                        tokens=tokens if isinstance(tokens, int) else None,
                        order=order if isinstance(order, int) else fallback_order,
                    )
                )

            return DocumentChunksResponse(
                doc_id=normalized_doc_id,
                chunk_count=len(chunks),
                chunks=chunks,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error /documents/{doc_id}/chunks: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete(
        "", response_model=ClearDocumentsResponse, dependencies=[Depends(combined_auth)]
    )
    async def clear_documents():
        """
        Clear all documents from the RAG system.

        This endpoint deletes all documents, entities, relationships, and files from the system.
        It uses the storage drop methods to properly clean up all data and removes all files
        from the input directory.

        Returns:
            ClearDocumentsResponse: A response object containing the status and message.
                - status="success":           All documents and files were successfully cleared.
                - status="partial_success":   Document clear job exit with some errors.
                - status="busy":              Operation could not be completed because the pipeline is busy.
                - status="fail":              All storage drop operations failed, with message
                - message: Detailed information about the operation results, including counts
                  of deleted files and any errors encountered.

        Raises:
            HTTPException: Raised when a serious error occurs during the clearing process,
                          with status code 500 and error details in the detail field.
        """
        from lightrag.kg.shared_storage import (
            get_namespace_data,
            get_namespace_lock,
        )

        current_rag, current_doc_manager = _current_runtime_objects()
        # Get pipeline status and lock
        pipeline_status = await get_namespace_data(
            "pipeline_status", workspace=current_rag.workspace
        )
        pipeline_status_lock = get_namespace_lock(
            "pipeline_status", workspace=current_rag.workspace
        )

        # Check and set status with lock
        async with pipeline_status_lock:
            if (
                pipeline_status.get("busy", False)
                or pipeline_status.get("scanning", False)
                or int(pipeline_status.get("pending_enqueues", 0) or 0) > 0
            ):
                return ClearDocumentsResponse(
                    status="busy",
                    message="Cannot clear documents while pipeline is busy",
                )
            # Set busy to true
            pipeline_status.update(
                {
                    "busy": True,
                    "job_name": "Clearing Documents",
                    "job_start": datetime.now().isoformat(),
                    "docs": 0,
                    "batchs": 0,
                    "cur_batch": 0,
                    "request_pending": False,  # Clear any previous request
                    "latest_message": "Starting document clearing process",
                    "destructive_busy": True,
                }
            )
            # Cleaning history_messages without breaking it as a shared list object
            del pipeline_status["history_messages"][:]
            pipeline_status["history_messages"].append(
                "Starting document clearing process"
            )

        try:
            # Use drop method to clear all data
            drop_tasks = []
            storages = [
                current_rag.text_chunks,
                current_rag.full_docs,
                current_rag.full_entities,
                current_rag.full_relations,
                current_rag.entity_chunks,
                current_rag.relation_chunks,
                current_rag.entities_vdb,
                current_rag.relationships_vdb,
                current_rag.chunks_vdb,
                current_rag.chunk_entity_relation_graph,
                current_rag.doc_status,
            ]

            # Log storage drop start
            if "history_messages" in pipeline_status:
                pipeline_status["history_messages"].append(
                    "Starting to drop storage components"
                )

            for storage in storages:
                if storage is not None:
                    drop_tasks.append(storage.drop())

            # Wait for all drop tasks to complete
            drop_results = await asyncio.gather(*drop_tasks, return_exceptions=True)

            # Check for errors and log results
            errors = []
            storage_success_count = 0
            storage_error_count = 0

            for i, result in enumerate(drop_results):
                storage_name = storages[i].__class__.__name__
                if isinstance(result, Exception):
                    error_msg = f"Error dropping {storage_name}: {str(result)}"
                    errors.append(error_msg)
                    logger.error(error_msg)
                    storage_error_count += 1
                elif isinstance(result, dict) and result.get("status") != "success":
                    # drop() reports a non-raising failure as {"status": "error"}
                    # (e.g. a backend that could not safely clear a kept legacy
                    # store). Honor it so the clear is not counted as successful
                    # while stale data remains and could be re-migrated/resurface.
                    error_msg = (
                        f"Error dropping {storage_name}: "
                        f"{result.get('message', 'unknown error')}"
                    )
                    errors.append(error_msg)
                    logger.error(error_msg)
                    storage_error_count += 1
                else:
                    namespace = storages[i].namespace
                    workspace = storages[i].workspace
                    logger.info(
                        f"Successfully dropped {storage_name}: {workspace}/{namespace}"
                    )
                    storage_success_count += 1

            # Log storage drop results
            if "history_messages" in pipeline_status:
                if storage_error_count > 0:
                    pipeline_status["history_messages"].append(
                        f"Dropped {storage_success_count} storage components with {storage_error_count} errors"
                    )
                else:
                    pipeline_status["history_messages"].append(
                        f"Successfully dropped all {storage_success_count} storage components"
                    )

            # If all storage operations failed, return error status and don't proceed with file deletion
            if storage_success_count == 0 and storage_error_count > 0:
                error_message = "All storage drop operations failed. Aborting document clearing process."
                logger.error(error_message)
                if "history_messages" in pipeline_status:
                    pipeline_status["history_messages"].append(error_message)
                return ClearDocumentsResponse(status="fail", message=error_message)

            # Log file deletion start
            if "history_messages" in pipeline_status:
                pipeline_status["history_messages"].append(
                    "Starting to delete files in input directory"
                )

            # Delete only files in the current directory, preserve files in subdirectories
            deleted_files_count = 0
            file_errors_count = 0

            for file_path in current_doc_manager.input_dir.glob("*"):
                if file_path.is_file():
                    try:
                        file_path.unlink()
                        deleted_files_count += 1
                    except Exception as e:
                        logger.error(f"Error deleting file {file_path}: {str(e)}")
                        file_errors_count += 1

            # Log file deletion results
            if "history_messages" in pipeline_status:
                if file_errors_count > 0:
                    pipeline_status["history_messages"].append(
                        f"Deleted {deleted_files_count} files with {file_errors_count} errors"
                    )
                    errors.append(f"Failed to delete {file_errors_count} files")
                else:
                    pipeline_status["history_messages"].append(
                        f"Successfully deleted {deleted_files_count} files"
                    )

            # Prepare final result message
            final_message = ""
            if errors:
                final_message = f"Cleared documents with some errors. Deleted {deleted_files_count} files."
                status = "partial_success"
            else:
                final_message = f"All documents cleared successfully. Deleted {deleted_files_count} files."
                status = "success"

            # Log final result
            if "history_messages" in pipeline_status:
                pipeline_status["history_messages"].append(final_message)

            # Return response based on results
            return ClearDocumentsResponse(status=status, message=final_message)
        except Exception as e:
            error_msg = f"Error clearing documents: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            if "history_messages" in pipeline_status:
                pipeline_status["history_messages"].append(error_msg)
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            # Reset busy status after completion
            async with pipeline_status_lock:
                pipeline_status["busy"] = False
                pipeline_status["destructive_busy"] = False
                completion_msg = "Document clearing process completed"
                pipeline_status["latest_message"] = completion_msg
                if "history_messages" in pipeline_status:
                    pipeline_status["history_messages"].append(completion_msg)

    @router.get(
        "/pipeline_status",
        dependencies=[Depends(combined_auth)],
        response_model=PipelineStatusResponse,
    )
    async def get_pipeline_status() -> PipelineStatusResponse:
        """
        Get the current status of the document indexing pipeline.

        This endpoint returns information about the current state of the document processing pipeline,
        including the processing status, progress information, and history messages.

        Returns:
            PipelineStatusResponse: A response object containing:
                - autoscanned (bool): Whether auto-scan has started
                - busy (bool): Whether the pipeline is currently busy
                - job_name (str): Current job name (e.g., indexing files/indexing texts)
                - job_start (str, optional): Job start time as ISO format string
                - docs (int): Total number of documents to be indexed
                - batchs (int): Number of batches for processing documents
                - cur_batch (int): Current processing batch
                - request_pending (bool): Flag for pending request for processing
                - latest_message (str): Latest message from pipeline processing
                - history_messages (List[str], optional): List of history messages (limited to latest 1000 entries,
                  with truncation message if more than 1000 messages exist)

        Raises:
            HTTPException: If an error occurs while retrieving pipeline status (500)
        """
        try:
            from lightrag.kg.shared_storage import (
                get_namespace_data,
                get_namespace_lock,
                get_all_update_flags_status,
            )

            current_rag, _ = _current_runtime_objects()
            pipeline_status = await get_namespace_data(
                "pipeline_status", workspace=current_rag.workspace
            )
            pipeline_status_lock = get_namespace_lock(
                "pipeline_status", workspace=current_rag.workspace
            )

            # Get update flags status for all namespaces
            update_status = await get_all_update_flags_status(
                workspace=current_rag.workspace
            )

            # Convert MutableBoolean objects to regular boolean values
            processed_update_status = {}
            for namespace, flags in update_status.items():
                processed_flags = []
                for flag in flags:
                    # Handle both multiprocess and single process cases
                    if hasattr(flag, "value"):
                        processed_flags.append(bool(flag.value))
                    else:
                        processed_flags.append(bool(flag))
                processed_update_status[namespace] = processed_flags

            async with pipeline_status_lock:
                # Convert to regular dict if it's a Manager.dict
                status_dict = dict(pipeline_status)

            # Add processed update_status to the status dictionary
            status_dict["update_status"] = processed_update_status

            # Convert history_messages to a regular list if it's a Manager.list
            # and limit to latest 1000 entries with truncation message if needed
            if "history_messages" in status_dict:
                history_list = list(status_dict["history_messages"])
                total_count = len(history_list)

                if total_count > 1000:
                    # Calculate truncated message count
                    truncated_count = total_count - 1000

                    # Take only the latest 1000 messages
                    latest_messages = history_list[-1000:]

                    # Add truncation message at the beginning
                    truncation_message = (
                        f"[Truncated history messages: {truncated_count}/{total_count}]"
                    )
                    status_dict["history_messages"] = [
                        truncation_message
                    ] + latest_messages
                else:
                    # No truncation needed, return all messages
                    status_dict["history_messages"] = history_list

            # Ensure job_start is properly formatted as a string with timezone information
            if "job_start" in status_dict and status_dict["job_start"]:
                # Use format_datetime to ensure consistent formatting
                status_dict["job_start"] = format_datetime(status_dict["job_start"])

            return PipelineStatusResponse(**status_dict)
        except Exception as e:
            logger.error(f"Error getting pipeline status: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    class DeleteDocByIdResponse(BaseModel):
        """Response model for single document deletion operation."""

        status: Literal["deletion_started", "busy", "not_allowed"] = Field(
            description="Status of the deletion operation"
        )
        message: str = Field(description="Message describing the operation result")
        doc_id: str = Field(description="The ID of the document to delete")

    @router.delete(
        "/delete_document",
        response_model=DeleteDocByIdResponse,
        dependencies=[Depends(combined_auth)],
        summary="Delete a document and all its associated data by its ID.",
    )
    async def delete_document(
        delete_request: DeleteDocRequest,
        background_tasks: BackgroundTasks,
    ) -> DeleteDocByIdResponse:
        """
        Delete documents and all their associated data by their IDs using background processing.

        Deletes specific documents and all their associated data, including their status,
        text chunks, vector embeddings, and any related graph data. When requested,
        cached LLM extraction responses are removed after graph deletion/rebuild completes.
        The deletion process runs in the background to avoid blocking the client connection.

        This operation is irreversible and will interact with the pipeline status.

        Args:
            delete_request (DeleteDocRequest): The request containing the document IDs and deletion options.
            background_tasks: FastAPI BackgroundTasks for async processing

        Returns:
            DeleteDocByIdResponse: The result of the deletion operation.
                - status="deletion_started": The document deletion has been initiated in the background.
                - status="busy": The pipeline is busy with another operation.

        Raises:
            HTTPException:
              - 500: If an unexpected internal error occurs during initialization.
        """
        doc_ids = delete_request.doc_ids

        try:
            from lightrag.kg.shared_storage import (
                get_namespace_data,
                get_namespace_lock,
            )

            current_rag, current_doc_manager = _current_runtime_objects()
            pipeline_status = await get_namespace_data(
                "pipeline_status", workspace=current_rag.workspace
            )
            pipeline_status_lock = get_namespace_lock(
                "pipeline_status", workspace=current_rag.workspace
            )

            # Check if pipeline is busy with proper lock
            async with pipeline_status_lock:
                if (
                    pipeline_status.get("busy", False)
                    or pipeline_status.get("scanning", False)
                    or int(pipeline_status.get("pending_enqueues", 0) or 0) > 0
                ):
                    return DeleteDocByIdResponse(
                        status="busy",
                        message="Cannot delete documents while pipeline is busy",
                        doc_id=", ".join(doc_ids),
                    )
                pipeline_status.update(
                    {
                        "busy": True,
                        "destructive_busy": True,
                        "job_name": f"Deleting {len(doc_ids)} Documents",
                        "job_start": datetime.now().isoformat(),
                        "docs": len(doc_ids),
                        "batchs": len(doc_ids),
                        "cur_batch": 0,
                        "request_pending": False,
                        "latest_message": "Starting document deletion process",
                    }
                )
                if "history_messages" in pipeline_status:
                    pipeline_status["history_messages"][:] = [
                        "Starting document deletion process"
                    ]

            # Add deletion task to background tasks
            background_tasks.add_task(
                background_delete_documents,
                current_rag,
                current_doc_manager,
                doc_ids,
                delete_request.delete_file,
                delete_request.delete_llm_cache,
            )

            return DeleteDocByIdResponse(
                status="deletion_started",
                message=f"Document deletion for {len(doc_ids)} documents has been initiated. Processing will continue in background.",
                doc_id=", ".join(doc_ids),
            )

        except Exception as e:
            error_msg = f"Error initiating document deletion for {delete_request.doc_ids}: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=error_msg)

    @router.post(
        "/clear_cache",
        response_model=ClearCacheResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def clear_cache(request: ClearCacheRequest):
        """
        Clear all cache data from the LLM response cache storage.

        This endpoint clears all cached LLM responses regardless of mode.
        The request body is accepted for API compatibility but is ignored.

        Args:
            request (ClearCacheRequest): The request body (ignored for compatibility).

        Returns:
            ClearCacheResponse: A response object containing the status and message.

        Raises:
            HTTPException: If an error occurs during cache clearing (500).
        """
        try:
            # Call the aclear_cache method (no modes parameter)
            await rag.aclear_cache()

            # Prepare success message
            message = "Successfully cleared all cache"

            return ClearCacheResponse(status="success", message=message)
        except Exception as e:
            logger.error(f"Error clearing cache: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/track_status/{track_id}",
        response_model=TrackStatusResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def get_track_status(track_id: str) -> TrackStatusResponse:
        """
        Get the processing status of documents by tracking ID.

        This endpoint retrieves all documents associated with a specific tracking ID,
        allowing users to monitor the processing progress of their uploaded files or inserted texts.

        Args:
            track_id (str): The tracking ID returned from upload, text, or texts endpoints

        Returns:
            TrackStatusResponse: A response object containing:
                - track_id: The tracking ID
                - documents: List of documents associated with this track_id
                - total_count: Total number of documents for this track_id

        Raises:
            HTTPException: If track_id is invalid (400) or an error occurs (500).
        """
        try:
            # Validate track_id
            if not track_id or not track_id.strip():
                raise HTTPException(status_code=400, detail="Track ID cannot be empty")

            track_id = track_id.strip()

            # Get documents by track_id
            docs_by_track_id = await rag.aget_docs_by_track_id(track_id)

            # Convert to response format
            documents = []
            status_summary = {}

            for doc_id, doc_status in docs_by_track_id.items():
                documents.append(
                    DocStatusResponse(
                        id=doc_id,
                        content_summary=doc_status.content_summary,
                        content_length=doc_status.content_length,
                        status=doc_status.status,
                        created_at=format_datetime(doc_status.created_at),
                        updated_at=format_datetime(doc_status.updated_at),
                        track_id=doc_status.track_id,
                        chunks_count=doc_status.chunks_count,
                        error_msg=doc_status.error_msg,
                        metadata=doc_status.metadata,
                        file_path=normalize_file_path(doc_status.file_path),
                    )
                )

                # Build status summary
                # Handle both DocStatus enum and string cases for robust deserialization
                status_key = str(doc_status.status)
                status_summary[status_key] = status_summary.get(status_key, 0) + 1

            return TrackStatusResponse(
                track_id=track_id,
                documents=documents,
                total_count=len(documents),
                status_summary=status_summary,
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting track status for {track_id}: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/paginated",
        response_model=PaginatedDocsResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def get_documents_paginated(
        request: DocumentsRequest,
    ) -> PaginatedDocsResponse:
        """
        Get documents with pagination support.

        This endpoint retrieves documents with pagination, filtering, and sorting capabilities.
        It provides better performance for large document collections by loading only the
        requested page of data.

        Args:
            request (DocumentsRequest): The request body containing pagination parameters

        Returns:
            PaginatedDocsResponse: A response object containing:
                - documents: List of documents for the current page
                - pagination: Pagination information (page, total_count, etc.)
                - status_counts: Count of documents by status for all documents

        Raises:
            HTTPException: If an error occurs while retrieving documents (500).
        """
        trace_id = uuid4().hex[:8]
        request_start = time.perf_counter()
        status_filter_value = (
            request.status_filter.value if request.status_filter is not None else None
        )
        status_filters_value = (
            [status.value for status in request.status_filters]
            if request.status_filters
            else None
        )

        performance_timing_log(
            "[documents/paginated][%s] Request start workspace=%s status_filter=%s status_filters=%s page=%s page_size=%s sort_field=%s sort_direction=%s",
            trace_id,
            getattr(rag, "workspace", ""),
            status_filter_value,
            status_filters_value,
            request.page,
            request.page_size,
            request.sort_field,
            request.sort_direction,
        )

        try:

            async def _timed_call(operation_name: str, operation):
                operation_start = time.perf_counter()
                performance_timing_log(
                    "[documents/paginated][%s] %s started",
                    trace_id,
                    operation_name,
                )
                try:
                    result = await operation
                except Exception:
                    elapsed = time.perf_counter() - operation_start
                    performance_timing_log(
                        "[documents/paginated][%s] %s failed after %.4fs",
                        trace_id,
                        operation_name,
                        elapsed,
                    )
                    raise

                elapsed = time.perf_counter() - operation_start
                performance_timing_log(
                    "[documents/paginated][%s] %s completed in %.4fs",
                    trace_id,
                    operation_name,
                    elapsed,
                )
                return result

            query_task_create_start = time.perf_counter()
            docs_task = asyncio.create_task(
                _timed_call(
                    "get_docs_paginated",
                    rag.doc_status.get_docs_paginated(
                        status_filter=request.status_filter,
                        status_filters=request.status_filters,
                        page=request.page,
                        page_size=request.page_size,
                        sort_field=request.sort_field,
                        sort_direction=request.sort_direction,
                    ),
                )
            )
            status_counts_task = asyncio.create_task(
                _timed_call(
                    "get_all_status_counts",
                    rag.doc_status.get_all_status_counts(),
                )
            )
            query_task_create_elapsed = time.perf_counter() - query_task_create_start
            performance_timing_log(
                "[documents/paginated][%s] Query tasks created in %.4fs",
                trace_id,
                query_task_create_elapsed,
            )

            query_await_start = time.perf_counter()
            (documents_with_ids, total_count), status_counts = await asyncio.gather(
                docs_task, status_counts_task
            )
            query_await_elapsed = time.perf_counter() - query_await_start
            performance_timing_log(
                "[documents/paginated][%s] Query tasks awaited in %.4fs",
                trace_id,
                query_await_elapsed,
            )

            # Convert documents to response format
            response_assembly_start = time.perf_counter()
            doc_responses = []
            for doc_id, doc in documents_with_ids:
                doc_responses.append(
                    DocStatusResponse(
                        id=doc_id,
                        content_summary=doc.content_summary,
                        content_length=doc.content_length,
                        status=doc.status,
                        created_at=format_datetime(doc.created_at),
                        updated_at=format_datetime(doc.updated_at),
                        track_id=doc.track_id,
                        chunks_count=doc.chunks_count,
                        error_msg=doc.error_msg,
                        metadata=doc.metadata,
                        file_path=normalize_file_path(doc.file_path),
                    )
                )

            # Calculate pagination info
            total_pages = (total_count + request.page_size - 1) // request.page_size
            has_next = request.page < total_pages
            has_prev = request.page > 1

            pagination = PaginationInfo(
                page=request.page,
                page_size=request.page_size,
                total_count=total_count,
                total_pages=total_pages,
                has_next=has_next,
                has_prev=has_prev,
            )
            response = PaginatedDocsResponse(
                documents=doc_responses,
                pagination=pagination,
                status_counts=status_counts,
            )
            response_assembly_elapsed = time.perf_counter() - response_assembly_start
            total_elapsed = time.perf_counter() - request_start

            performance_timing_log(
                "[documents/paginated][%s] Response assembled in %.4fs",
                trace_id,
                response_assembly_elapsed,
            )
            performance_timing_log(
                "[documents/paginated][%s] Request completed in %.4fs returned_rows=%s total_count=%s status_count_keys=%s",
                trace_id,
                total_elapsed,
                len(doc_responses),
                total_count,
                sorted(status_counts.keys()),
            )

            return response

        except Exception as e:
            total_elapsed = time.perf_counter() - request_start
            performance_timing_log(
                "[documents/paginated][%s] Request failed after %.4fs",
                trace_id,
                total_elapsed,
            )
            logger.error(f"Error getting paginated documents: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/status_counts",
        response_model=StatusCountsResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def get_document_status_counts() -> StatusCountsResponse:
        """
        Get counts of documents by status.

        This endpoint retrieves the count of documents in each processing status
        (PENDING, PROCESSING, PROCESSED, FAILED) for all documents in the system.

        Returns:
            StatusCountsResponse: A response object containing status counts

        Raises:
            HTTPException: If an error occurs while retrieving status counts (500).
        """
        try:
            status_counts = await rag.doc_status.get_all_status_counts()
            return StatusCountsResponse(status_counts=status_counts)

        except Exception as e:
            logger.error(f"Error getting document status counts: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/reprocess_failed",
        response_model=ReprocessResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def reprocess_failed_documents(background_tasks: BackgroundTasks):
        """
        Reprocess failed and pending documents.

        This endpoint triggers the document processing pipeline which automatically
        picks up and reprocesses documents in the following statuses:
        - FAILED: Documents that failed during previous processing attempts
        - PENDING: Documents waiting to be processed
        - PROCESSING: Documents with abnormally terminated processing (e.g., server crashes)

        This is useful for recovering from server crashes, network errors, LLM service
        outages, or other temporary failures that caused document processing to fail.

        The processing happens in the background and can be monitored by checking the
        pipeline status. The reprocessed documents retain their original track_id from
        initial upload, so use their original track_id to monitor progress.

        Returns:
            ReprocessResponse: Response with status and message.
                track_id is always empty string because reprocessed documents retain
                their original track_id from initial upload.

        Raises:
            HTTPException: If an error occurs while initiating reprocessing (500).
        """
        try:
            # Start the reprocessing in the background
            # Note: Reprocessed documents retain their original track_id from initial upload
            runtime = get_current_runtime()
            current_rag = runtime.rag if runtime is not None else rag
            background_tasks.add_task(current_rag.apipeline_process_enqueue_documents)
            logger.info("Reprocessing of failed documents initiated")

            return ReprocessResponse(
                status="reprocessing_started",
                message="Reprocessing of failed documents has been initiated in background. Documents retain their original track_id.",
            )

        except Exception as e:
            logger.error(f"Error initiating reprocessing of failed documents: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.post(
        "/cancel_pipeline",
        response_model=CancelPipelineResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def cancel_pipeline():
        """
        Request cancellation of the currently running pipeline.

        This endpoint sets a cancellation flag in the pipeline status. The pipeline will:
        1. Check this flag at key processing points
        2. Stop processing new documents
        3. Cancel all running document processing tasks
        4. Mark all PROCESSING documents as FAILED with reason "User cancelled"

        The cancellation is graceful and ensures data consistency. Documents that have
        completed processing will remain in PROCESSED status.

        Returns:
            CancelPipelineResponse: Response with status and message
                - status="cancellation_requested": Cancellation flag has been set
                - status="not_busy": Pipeline is not currently running

        Raises:
            HTTPException: If an error occurs while setting cancellation flag (500).
        """
        try:
            from lightrag.kg.shared_storage import (
                get_namespace_data,
                get_namespace_lock,
            )

            current_rag, _ = _current_runtime_objects()
            pipeline_status = await get_namespace_data(
                "pipeline_status", workspace=current_rag.workspace
            )
            pipeline_status_lock = get_namespace_lock(
                "pipeline_status", workspace=current_rag.workspace
            )

            async with pipeline_status_lock:
                if not pipeline_status.get("busy", False):
                    return CancelPipelineResponse(
                        status="not_busy",
                        message="Pipeline is not currently running. No cancellation needed.",
                    )

                # Set cancellation flag
                pipeline_status["cancellation_requested"] = True
                cancel_msg = "Pipeline cancellation requested by user"
                logger.info(cancel_msg)
                pipeline_status["latest_message"] = cancel_msg
                pipeline_status["history_messages"].append(cancel_msg)

            return CancelPipelineResponse(
                status="cancellation_requested",
                message="Pipeline cancellation has been requested. Documents will be marked as FAILED.",
            )

        except Exception as e:
            logger.error(f"Error requesting pipeline cancellation: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/scan-progress", dependencies=[Depends(combined_auth)])
    async def get_scan_progress():
        """
        Get the current scan progress status.

        Returns:
            dict: Scan progress containing:
                - is_scanning (bool): Whether a scan is currently running
                - current_file (str): Name of the file currently being scanned
                - indexed_count (int): Number of files indexed so far
                - total_files (int): Total number of files to scan
                - progress (float): Progress percentage (0-100)
        """
        try:
            from lightrag.kg.shared_storage import get_namespace_data

            current_rag, _ = _current_runtime_objects()
            pipeline_status = await get_namespace_data(
                "pipeline_status", workspace=current_rag.workspace
            )
            total = pipeline_status.get("scan_total_files", 0) or 0
            indexed = pipeline_status.get("scan_indexed_count", 0) or 0
            return {
                "is_scanning": bool(pipeline_status.get("scan_is_scanning", False)),
                "current_file": str(
                    pipeline_status.get("scan_current_file", "") or ""
                ),
                "indexed_count": indexed,
                "total_files": total,
                "progress": round(
                    (indexed / total * 100) if total > 0 else 0, 1
                ),
            }
        except Exception as e:
            logger.error(f"Error getting scan progress: {str(e)}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error getting scan progress: {str(e)}"
            )

    return router
