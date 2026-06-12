from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
import yaml

import lightrag.prompt as prompt_module
from lightrag.api.utils_api import get_combined_auth_dependency
from lightrag.api.workspace_runtime import get_current_runtime
from lightrag.api.workspace_registry import normalize_workspace_identifier


logger = logging.getLogger(__name__)


_PROMPT_KIND_SLUG = "entity-type"
_PROMPT_SUFFIX = ".yml"
_WORKSPACE_PROMPT_RE = re.compile(
    r"^(?P<workspace>[A-Za-z0-9][A-Za-z0-9_.-]*)--"
    r"(?P<prompt_slug>[A-Za-z0-9][A-Za-z0-9_.-]*)--"
    r"v(?P<version>[1-9][0-9]*)"
    r"(?P<suffix>\.ya?ml)$",
    re.IGNORECASE,
)
_SAFE_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


@dataclass(frozen=True)
class WorkspacePromptFileName:
    workspace: str
    prompt_slug: str
    version: int
    suffix: str


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class WorkspacePromptFile(BaseModel):
    file_name: str
    workspace: str
    prompt_slug: str
    version: int
    active: bool
    source: Literal["workspace", "global"]
    updated_at: str | None
    size_bytes: int


class PromptListResponse(BaseModel):
    workspace: str
    active_file: str | None
    files: list[WorkspacePromptFile]


class PromptReadResponse(BaseModel):
    file_name: str
    content: str
    profile: dict[str, Any]
    validation: ValidationResult


class PromptValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    use_json: bool | None = None


class PromptSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    activate: bool = False


class PromptSaveResponse(BaseModel):
    file: WorkspacePromptFile
    validation: ValidationResult
    active_file: str | None


class PromptActivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(min_length=1)

    @field_validator("file_name", mode="after")
    @classmethod
    def _strip_file_name(cls, value: str) -> str:
        return value.strip()


class PromptActivateResponse(BaseModel):
    active_file: str
    file: WorkspacePromptFile
    validation: ValidationResult


class PromptDeactivateResponse(BaseModel):
    active_file: None = None
    previous_file: WorkspacePromptFile | None = None


class PromptAssistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirements: str = Field(min_length=1, max_length=4000)
    current_content: str | None = Field(default=None, max_length=30000)
    sample_text: str | None = Field(default=None, max_length=8000)
    language: Literal["auto", "en", "zh", "ja"] = "auto"
    # Reserved for callers that want to override runtime default. Frontend UI
    # does NOT expose this; defaults to ``rag.entity_extraction_use_json``.
    use_json: bool | None = None


class PromptAssistResponse(BaseModel):
    content: str
    validation: ValidationResult
    warnings: list[str] = Field(default_factory=list)
    raw_output: str = Field(
        description=(
            "Verbatim output of the LLM attempt that produced `content` and "
            "`validation`; when a repair ran, this is the repair attempt's output."
        )
    )
    model: str | None = None


def parse_workspace_prompt_file_name(
    file_name: str,
) -> WorkspacePromptFileName | None:
    match = _WORKSPACE_PROMPT_RE.fullmatch(file_name.strip())
    if match is None:
        return None
    return WorkspacePromptFileName(
        workspace=match.group("workspace"),
        prompt_slug=match.group("prompt_slug"),
        version=int(match.group("version")),
        suffix=match.group("suffix").lower(),
    )


def _validate_safe_slug(value: str, label: str) -> str:
    normalized = value.strip()
    if not normalized or not _SAFE_SLUG_RE.fullmatch(normalized):
        raise ValueError(
            f"{label} must start with a letter or digit and contain only "
            "letters, digits, '.', '_' or '-'."
        )
    return normalized


def _normalize_workspace(workspace: str) -> str:
    normalized = normalize_workspace_identifier(workspace.strip() or "default")
    return _validate_safe_slug(normalized, "workspace")


def build_workspace_prompt_file_name(
    workspace: str,
    prompt_slug: str,
    version: int,
) -> str:
    if version < 1:
        raise ValueError("version must be greater than or equal to 1.")
    safe_workspace = _normalize_workspace(workspace)
    safe_slug = _validate_safe_slug(prompt_slug, "prompt_slug")
    return f"{safe_workspace}--{safe_slug}--v{version}{_PROMPT_SUFFIX}"


def is_global_prompt_file(file_name: str) -> bool:
    parsed = parse_workspace_prompt_file_name(file_name)
    if parsed is not None:
        return False
    try:
        prompt_module.resolve_entity_type_prompt_path(file_name)
    except ValueError:
        return False
    return True


def resolve_prompt_file_for_workspace(
    file_name: str,
    *,
    workspace: str,
    must_exist: bool = True,
) -> Path:
    path = prompt_module.resolve_entity_type_prompt_path(file_name)
    parsed = parse_workspace_prompt_file_name(path.name)
    safe_workspace = _normalize_workspace(workspace)
    if parsed is not None and parsed.workspace != safe_workspace:
        raise ValueError(
            f"Prompt file '{path.name}' does not belong to workspace "
            f"'{safe_workspace}'."
        )
    if must_exist and not path.exists():
        raise FileNotFoundError(f"Prompt file '{path.name}' does not exist.")
    return path


def _current_workspace(workspace_getter: Callable[[], str | None] | None) -> str:
    if workspace_getter is None:
        return "default"
    return _normalize_workspace(workspace_getter() or "default")


def _resolve_rag(rag: Any) -> Any:
    runtime = get_current_runtime()
    if runtime is not None:
        return runtime.rag
    return rag


def _active_file(rag: Any) -> str | None:
    rag = _resolve_rag(rag)
    addon_params = getattr(rag, "addon_params", {}) or {}
    active = addon_params.get("entity_type_prompt_file")
    if not active:
        return None
    return str(active)


def _use_json_mode(rag: Any, explicit: bool | None = None) -> bool:
    if explicit is not None:
        return explicit
    rag = _resolve_rag(rag)
    return bool(getattr(rag, "entity_extraction_use_json", False))


def _load_prompt_profile_from_content(content: str, source_label: str) -> dict[str, Any]:
    try:
        raw_profile = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError(f"{source_label} contains invalid YAML: {exc}") from exc

    if raw_profile is None:
        raw_profile = {}
    if not isinstance(raw_profile, dict):
        raise ValueError(f"{source_label} must contain a YAML mapping.")

    profile: dict[str, Any] = {}
    guidance = raw_profile.get("entity_types_guidance")
    if guidance is not None:
        if not isinstance(guidance, str) or not guidance.strip():
            raise ValueError(
                f"{source_label} field 'entity_types_guidance' must be a "
                "non-empty string."
            )
        profile["entity_types_guidance"] = guidance.rstrip()

    for field_name in (
        "entity_extraction_examples",
        "entity_extraction_json_examples",
    ):
        if field_name not in raw_profile:
            continue
        value = raw_profile[field_name]
        if not isinstance(value, list):
            raise ValueError(f"{source_label} field '{field_name}' must be a list.")
        normalized_examples: list[str] = []
        for index, item in enumerate(value):
            if not isinstance(item, str) or not item.strip():
                raise ValueError(
                    f"{source_label} field '{field_name}' item {index} must be "
                    "a non-empty string."
                )
            normalized_examples.append(item.rstrip())
        profile[field_name] = normalized_examples

    return profile


def _validate_content(
    content: str,
    *,
    use_json: bool,
    source_label: str,
) -> tuple[dict[str, Any], ValidationResult]:
    try:
        profile = _load_prompt_profile_from_content(content, source_label)
        default_profile = prompt_module.get_default_entity_extraction_prompt_profile()
        prompt_module.validate_entity_extraction_prompt_profile_for_mode(
            {
                "entity_types_guidance": profile.get(
                    "entity_types_guidance",
                    default_profile["entity_types_guidance"],
                ),
                "entity_extraction_examples": profile.get(
                    "entity_extraction_examples", []
                ),
                "entity_extraction_json_examples": profile.get(
                    "entity_extraction_json_examples", []
                ),
            },
            use_json=use_json,
            prompt_file_name=source_label,
        )
    except Exception as exc:
        return {}, ValidationResult(valid=False, errors=[str(exc)])
    return profile, ValidationResult(valid=True, errors=[])


def _file_response(
    path: Path,
    *,
    workspace: str,
    active_file: str | None,
) -> WorkspacePromptFile:
    parsed = parse_workspace_prompt_file_name(path.name)
    stat = path.stat()
    updated_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
    if parsed is None:
        prompt_slug = path.stem
        version = 0
        source: Literal["workspace", "global"] = "global"
        file_workspace = workspace
    else:
        prompt_slug = parsed.prompt_slug
        version = parsed.version
        source = "workspace"
        file_workspace = parsed.workspace
    return WorkspacePromptFile(
        file_name=path.name,
        workspace=file_workspace,
        prompt_slug=prompt_slug,
        version=version,
        active=path.name == active_file,
        source=source,
        updated_at=updated_at,
        size_bytes=stat.st_size,
    )


def _list_prompt_files(workspace: str, active_file: str | None) -> list[WorkspacePromptFile]:
    prompt_dir = prompt_module.get_entity_type_prompt_dir()
    if not prompt_dir.exists():
        return []

    files: list[WorkspacePromptFile] = []
    for path in prompt_dir.iterdir():
        if not path.is_file():
            continue
        try:
            prompt_module.resolve_entity_type_prompt_path(path.name)
        except ValueError:
            continue
        parsed = parse_workspace_prompt_file_name(path.name)
        if parsed is not None and parsed.workspace != workspace:
            continue
        files.append(_file_response(path, workspace=workspace, active_file=active_file))

    return sorted(files, key=lambda item: (item.source != "workspace", item.file_name))


def _activate_prompt(rag: Any, file_name: str) -> None:
    rag = _resolve_rag(rag)
    if not hasattr(rag, "addon_params") or getattr(rag, "addon_params") is None:
        rag.addon_params = {}
    rag.addon_params["entity_type_prompt_file"] = file_name
    refresh = getattr(rag, "_refresh_addon_params_cache", None)
    if callable(refresh):
        refresh()


def _deactivate_prompt(rag: Any) -> str | None:
    rag = _resolve_rag(rag)
    addon_params = getattr(rag, "addon_params", {}) or {}
    previous = addon_params.pop("entity_type_prompt_file", None)
    refresh = getattr(rag, "_refresh_addon_params_cache", None)
    if callable(refresh):
        refresh()
    return previous if previous else None


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_file.write(content)
            temp_file.flush()
            os.fsync(temp_file.fileno())
            temp_path = Path(temp_file.name)
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def _http_error_from_exception(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def _resolve_assist_llm(rag: Any) -> tuple[Callable[..., Any], str | None]:
    """Return ``(callable, model_name)`` for the assist endpoint.

    Prefers ``rag.role_llm_funcs["query"]`` (matches the prompt-authoring
    workload: short, user-driven, not tied to entity extraction caching).
    Falls back to ``rag.llm_model_func``. Raises 503 if neither is callable.
    """
    rag = _resolve_rag(rag)
    role_funcs = getattr(rag, "role_llm_funcs", None) or {}
    candidate = role_funcs.get("query") if isinstance(role_funcs, dict) else None
    if not callable(candidate):
        candidate = getattr(rag, "llm_model_func", None)
    if not callable(candidate):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM is not configured for this workspace.",
        )
    model_name = getattr(rag, "llm_model_name", None)
    if model_name is not None:
        model_name = str(model_name)
    return candidate, model_name


_YAML_FENCE_RE = re.compile(
    r"^\s*```(?:ya?ml)?\s*\n(?P<body>.*?)\n```\s*$",
    re.DOTALL | re.IGNORECASE,
)


def _strip_yaml_fence(raw: str) -> str:
    """Remove a leading ```yaml ... ``` fence if the LLM wrapped its output."""
    if not raw:
        return raw
    match = _YAML_FENCE_RE.match(raw.strip())
    if match:
        return match.group("body")
    return raw


_ASSIST_TEXT_FORMAT_RULES = (
    "Each item in `entity_extraction_examples` MUST be one string with three "
    "sections, in order: `---Entity Types---` (a bullet list mirroring "
    "entity_types_guidance), `---Input Text---` (a code-fenced sample "
    "passage), and `---Output---` followed by the extraction rows.\n"
    "Row syntax (use the literal delimiter `<|#|>`):\n"
    "  entity<|#|>NAME<|#|>TYPE<|#|>DESCRIPTION\n"
    "  relation<|#|>SOURCE<|#|>TARGET<|#|>KEYWORDS<|#|>DESCRIPTION\n"
    "Entity rows have exactly 4 fields; relation rows exactly 5. List all "
    "entity rows first, then all relation rows, and end every example with "
    "the literal line `<|COMPLETE|>`.\n"
    "Do NOT use curly braces anywhere inside `entity_extraction_examples` "
    "items: no `{tuple_delimiter}`-style placeholders and no other `{` or "
    "`}` characters. Write the delimiters literally as shown above."
)

_ASSIST_JSON_FORMAT_RULES = (
    "Each item in `entity_extraction_json_examples` MUST be one string with "
    "three sections, in order: `---Entity Types---` (a bullet list mirroring "
    "entity_types_guidance), `---Input Text---` (a code-fenced sample "
    "passage), and `---Output---` followed by ONE valid JSON object with "
    "`entities` and `relationships` arrays.\n"
    'Entity objects use keys: "name", "type", "description". Relationship '
    'objects use keys: "source", "target", "keywords", "description".'
)


def _render_assist_reference_example(
    default_profile: dict[str, Any], use_json: bool
) -> str:
    """Return the first built-in example, rendered with literal delimiters."""
    key = (
        "entity_extraction_json_examples" if use_json else "entity_extraction_examples"
    )
    examples = default_profile.get(key) or []
    if not examples:
        return ""
    first = str(examples[0])
    if use_json:
        return first.rstrip()
    return first.format(
        tuple_delimiter=prompt_module.PROMPTS["DEFAULT_TUPLE_DELIMITER"],
        completion_delimiter=prompt_module.PROMPTS["DEFAULT_COMPLETION_DELIMITER"],
        entity_types_guidance="",
        language="English",
    ).rstrip()


def _build_prompt_assist_system_prompt(
    use_json: bool, default_profile: dict[str, Any]
) -> str:
    """Compose the assist system prompt.

    Names a single REQUIRED examples key for the active extraction mode,
    embeds the concrete format contract plus a rendered reference example,
    and keeps the full default guidance as a domain-adaptation baseline.
    """
    default_guidance = default_profile.get("entity_types_guidance", "").rstrip()
    required_key = (
        "entity_extraction_json_examples" if use_json else "entity_extraction_examples"
    )
    optional_key = (
        "entity_extraction_examples" if use_json else "entity_extraction_json_examples"
    )
    format_rules = _ASSIST_JSON_FORMAT_RULES if use_json else _ASSIST_TEXT_FORMAT_RULES
    reference_example = _render_assist_reference_example(default_profile, use_json)
    return (
        "You are helping the user author a LightRAG entity extraction prompt "
        "profile. Return ONLY a YAML mapping. Do not wrap the output in "
        "markdown fences. Do not add any prose before or after the YAML.\n"
        "Required keys:\n"
        "- `entity_types_guidance`: non-empty string — a short classification "
        "instruction followed by `- TypeName: description` bullet lines "
        "tailored to the user's domain.\n"
        f"- `{required_key}`: list of 1-3 example strings following the "
        "format contract below.\n"
        f"You may additionally include `{optional_key}`, but never omit "
        f"`{required_key}`.\n\n"
        f"{format_rules}\n\n"
        "Reference example — imitate the structure, adapt the content to the "
        "user's domain:\n"
        f"<reference_example>\n{reference_example}\n</reference_example>\n\n"
        "Default `entity_types_guidance` baseline (reference only, adapt to "
        "the user's domain):\n"
        f"{default_guidance}"
    )


_ASSIST_LANGUAGE_NAMES = {"en": "English", "zh": "Chinese", "ja": "Japanese"}


def _build_prompt_assist_user_prompt(
    request: PromptAssistRequest,
) -> str:
    """Compose the user prompt.

    ``language="auto"`` resolves to a follow-the-requirements instruction.
    ``sample_text`` grounds the generated examples in the user's corpus;
    ``current_content`` is wrapped in ``<current_yaml>`` so the model treats
    it as a baseline to revise, not as part of the requirements.
    """
    if request.language == "auto":
        language_line = (
            "Write the draft in the same language as the requirements above."
        )
    else:
        language_line = (
            f"Write the draft in {_ASSIST_LANGUAGE_NAMES[request.language]}."
        )
    parts = [
        f"Requirements:\n{request.requirements.strip()}",
        language_line,
    ]
    if request.sample_text:
        parts.append(
            "Representative sample of the user's corpus. Ground the examples' "
            "`---Input Text---` passages in this material (quote or "
            "paraphrase it):\n"
            f"<sample_text>\n{request.sample_text.rstrip()}\n</sample_text>"
        )
    if request.current_content:
        parts.append(
            "Current YAML draft (modify, do not echo verbatim unless "
            "appropriate):\n"
            f"<current_yaml>\n{request.current_content.rstrip()}\n</current_yaml>"
        )
    return "\n\n".join(parts)


async def _invoke_assist_llm(
    llm_callable: Callable[..., Any],
    *,
    user_prompt: str,
    system_prompt: str,
) -> str:
    """Call the runtime LLM with strict expectations and normalize errors."""
    try:
        result = await llm_callable(
            user_prompt,
            system_prompt=system_prompt,
            stream=False,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — provider errors are heterogeneous
        logger.warning("Assist LLM call failed: %s", exc.__class__.__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LLM provider call failed.",
        ) from exc
    if not isinstance(result, str):
        logger.error(
            "Assist LLM returned non-string payload of type %s",
            type(result).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LLM returned an unsupported response shape.",
        )
    return result


def _build_prompt_assist_repair_prompt(
    previous_draft: str, errors: list[str], original_user_prompt: str
) -> str:
    """Feed validation errors back for a single corrective retry."""
    error_lines = "\n".join(f"- {error}" for error in errors)
    return (
        "Your previous draft failed validation.\n\n"
        "Original request (unchanged, still applies):\n"
        f"<original_request>\n{original_user_prompt.rstrip()}\n</original_request>\n\n"
        f"Validation errors:\n{error_lines}\n\n"
        f"<previous_draft>\n{previous_draft.rstrip()}\n</previous_draft>\n\n"
        "Fix the errors and return the corrected YAML mapping only. Do not "
        "add any prose or markdown fences."
    )


async def _attempt_assist_repair(
    llm_callable: Callable[..., Any],
    *,
    system_prompt: str,
    user_prompt: str,
    draft: str,
    raw_output: str,
    validation: ValidationResult,
    use_json: bool,
    warnings: list[str],
) -> tuple[str, str, ValidationResult]:
    """One-shot repair pass for an invalid assist draft.

    Returns ``(content, raw_output, validation)``: the repaired attempt when
    the repair LLM call succeeds (whether or not it validates), or the
    original draft when the repair call itself fails.
    """
    repair_prompt = _build_prompt_assist_repair_prompt(
        draft, validation.errors, user_prompt
    )
    try:
        repaired_raw = await _invoke_assist_llm(
            llm_callable, user_prompt=repair_prompt, system_prompt=system_prompt
        )
    except HTTPException:
        warnings.append(
            "Draft failed validation; the automatic repair attempt could not "
            "be completed."
        )
        return draft, raw_output, validation

    repaired = _strip_yaml_fence(repaired_raw)
    _profile, repaired_validation = _validate_content(
        repaired, use_json=use_json, source_label="assist draft"
    )
    if repaired_validation.valid:
        warnings.append(
            "Initial draft failed validation; an automatic repair attempt "
            "fixed it."
        )
    else:
        warnings.append(
            "Draft failed validation; one automatic repair attempt did not "
            "fix it."
        )
    return repaired, repaired_raw, repaired_validation


def create_prompt_routes(
    rag: Any,
    api_key: str | None = None,
    *,
    workspace_getter: Callable[[], str | None] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/prompts", tags=["prompts"])
    combined_auth = get_combined_auth_dependency(api_key)

    @router.get(
        "/entity-type",
        response_model=PromptListResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def list_entity_type_prompts():
        workspace = _current_workspace(workspace_getter)
        active_file = _active_file(rag)
        return PromptListResponse(
            workspace=workspace,
            active_file=active_file,
            files=_list_prompt_files(workspace, active_file),
        )

    @router.get(
        "/entity-type/{file_name}",
        response_model=PromptReadResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def read_entity_type_prompt(file_name: str):
        workspace = _current_workspace(workspace_getter)
        try:
            path = resolve_prompt_file_for_workspace(file_name, workspace=workspace)
            content = path.read_text(encoding="utf-8")
        except Exception as exc:
            raise _http_error_from_exception(exc) from exc

        profile, validation = _validate_content(
            content,
            use_json=_use_json_mode(rag),
            source_label=path.name,
        )
        return PromptReadResponse(
            file_name=path.name,
            content=content,
            profile=profile,
            validation=validation,
        )

    @router.post(
        "/entity-type/validate",
        response_model=ValidationResult,
        dependencies=[Depends(combined_auth)],
    )
    async def validate_entity_type_prompt(request: PromptValidateRequest):
        _, validation = _validate_content(
            request.content,
            use_json=_use_json_mode(rag, request.use_json),
            source_label="request content",
        )
        return validation

    @router.put(
        "/entity-type/{prompt_slug}/versions/{version}",
        response_model=PromptSaveResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def save_entity_type_prompt_version(
        prompt_slug: str,
        version: int,
        request: PromptSaveRequest,
    ):
        workspace = _current_workspace(workspace_getter)
        try:
            file_name = build_workspace_prompt_file_name(
                workspace, prompt_slug, version
            )
            _profile, validation = _validate_content(
                request.content,
                use_json=_use_json_mode(rag),
                source_label=file_name,
            )
            if not validation.valid:
                raise ValueError("; ".join(validation.errors))
            path = prompt_module.resolve_entity_type_prompt_path(file_name)
            _atomic_write(path, request.content)
            if request.activate:
                _activate_prompt(rag, file_name)
            active_file = _active_file(rag)
            file = _file_response(path, workspace=workspace, active_file=active_file)
            return PromptSaveResponse(
                file=file,
                validation=validation,
                active_file=active_file,
            )
        except Exception as exc:
            raise _http_error_from_exception(exc) from exc

    @router.post(
        "/entity-type/activate",
        response_model=PromptActivateResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def activate_entity_type_prompt(request: PromptActivateRequest):
        workspace = _current_workspace(workspace_getter)
        try:
            path = resolve_prompt_file_for_workspace(
                request.file_name,
                workspace=workspace,
            )
            content = path.read_text(encoding="utf-8")
            _profile, validation = _validate_content(
                content,
                use_json=_use_json_mode(rag),
                source_label=path.name,
            )
            if not validation.valid:
                raise ValueError("; ".join(validation.errors))
            _activate_prompt(rag, path.name)
            active_file = _active_file(rag)
            return PromptActivateResponse(
                active_file=path.name,
                file=_file_response(path, workspace=workspace, active_file=active_file),
                validation=validation,
            )
        except Exception as exc:
            raise _http_error_from_exception(exc) from exc

    @router.post(
        "/entity-type/deactivate",
        response_model=PromptDeactivateResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def deactivate_entity_type_prompt():
        workspace = _current_workspace(workspace_getter)
        previous_name = _deactivate_prompt(rag)
        previous_file = None
        if previous_name:
            try:
                path = resolve_prompt_file_for_workspace(
                    previous_name, workspace=workspace, must_exist=False
                )
                if path.exists():
                    previous_file = _file_response(
                        path, workspace=workspace, active_file=None
                    )
            except ValueError:
                pass
        return PromptDeactivateResponse(previous_file=previous_file)

    @router.post(
        "/entity-type/assist",
        response_model=PromptAssistResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def assist_entity_type_prompt(request: PromptAssistRequest):
        llm_callable, model_name = _resolve_assist_llm(rag)
        use_json = _use_json_mode(rag, request.use_json)
        default_profile = prompt_module.get_default_entity_extraction_prompt_profile()
        system_prompt = _build_prompt_assist_system_prompt(use_json, default_profile)
        user_prompt = _build_prompt_assist_user_prompt(request)
        raw_output = await _invoke_assist_llm(
            llm_callable,
            user_prompt=user_prompt,
            system_prompt=system_prompt,
        )
        cleaned = _strip_yaml_fence(raw_output)
        _profile, validation = _validate_content(
            cleaned,
            use_json=use_json,
            source_label="assist draft",
        )
        warnings: list[str] = []
        if not validation.valid:
            cleaned, raw_output, validation = await _attempt_assist_repair(
                llm_callable,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                draft=cleaned,
                raw_output=raw_output,
                validation=validation,
                use_json=use_json,
                warnings=warnings,
            )
        return PromptAssistResponse(
            content=cleaned,
            validation=validation,
            warnings=warnings,
            raw_output=raw_output,
            model=model_name,
        )

    return router
