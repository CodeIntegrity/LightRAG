from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
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


class PromptDeleteResponse(BaseModel):
    deleted_file: str
    active_file: str | None = None


class PromptAssistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirements: str = Field(min_length=1, max_length=4000)
    current_content: str | None = Field(default=None, max_length=30000)
    sample_text: str | None = Field(default=None, max_length=8000)
    language: Literal["auto", "en", "zh", "ja"] = "auto"
    # Deprecated compatibility carrier. Assist now always generates both text
    # and JSON examples; runtime extraction mode chooses which list to use.
    use_json: bool | None = Field(
        default=None,
        json_schema_extra={"deprecated": True},
    )


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


class _BlockStyleDumper(yaml.SafeDumper):
    """Force indented block sequences so output matches the sample files."""

    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow=flow, indentless=False)


def _represent_multiline_str(dumper: yaml.Dumper, data: str) -> Any:
    """Render multi-line strings as literal ``|`` blocks, not quoted scalars.

    The assist LLM frequently emits double-quoted scalars with escaped ``\\n``,
    which are valid YAML but show as a single unreadable line in the editor.
    Appending one trailing newline picks clip chomping (``|``), matching
    ``prompts/samples/*.sample.yml``.
    """
    if "\n" in data:
        return dumper.represent_scalar(
            "tag:yaml.org,2002:str", data + "\n", style="|"
        )
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


_BlockStyleDumper.add_representer(str, _represent_multiline_str)


def _recover_escaped_newlines(value: str) -> str:
    r"""Turn literal ``\n`` escape sequences into real line breaks.

    The assist LLM sometimes single-quotes a multi-line value while still
    writing ``\n`` escapes; YAML single-quotes keep those literal, so the
    parsed string carries a backslash-n pair instead of a break. Double-quoted
    values already decoded to real newlines and contain no literal ``\n``, so
    this leaves them untouched.
    """
    if "\\n" not in value:
        return value
    return value.replace("\\r\\n", "\n").replace("\\n", "\n").rstrip()


def _normalize_profile_yaml(content: str, source_label: str) -> str:
    """Re-serialize valid profile YAML into readable sample-style block scalars.

    Round-trips the content through the parser and re-dumps it. Returns the
    original content untouched when it cannot be parsed — callers only
    normalize drafts that already validated.
    """
    try:
        profile = _load_prompt_profile_from_content(content, source_label)
    except ValueError:
        return content
    if not profile:
        return content
    normalized: dict[str, Any] = {}
    for key, value in profile.items():
        if isinstance(value, str):
            normalized[key] = _recover_escaped_newlines(value)
        elif isinstance(value, list):
            normalized[key] = [
                _recover_escaped_newlines(item) if isinstance(item, str) else item
                for item in value
            ]
        else:
            normalized[key] = value
    return yaml.dump(
        normalized,
        Dumper=_BlockStyleDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=4096,
    )


# Characters the extraction stage rejects in an entity type (see the entity
# `type` validation in operate.py). A type whose name carries any of these is
# silently dropped during extraction, so the authoring/save path rejects it up
# front; the assist repair loop also feeds the message back to the model.
_FORBIDDEN_ENTITY_TYPE_CHARS = ("'", "(", ")", "<", ">", "|", "/", "\\", ",")
_ENTITY_TYPE_BULLET_RE = re.compile(
    r"^[ \t]*-[ \t]+(?P<name>[^:：\n]+)[:：]", re.MULTILINE
)


def _check_entity_type_names(guidance: str, source_label: str) -> None:
    """Reject ``- TypeName: ...`` bullets whose type name uses a character the
    extractor forbids (e.g. the slash in ``参数/指标``), which would otherwise be
    silently discarded at extraction time."""
    offenders: list[str] = []
    for match in _ENTITY_TYPE_BULLET_RE.finditer(guidance):
        name = match.group("name").strip()
        bad = [char for char in _FORBIDDEN_ENTITY_TYPE_CHARS if char in name]
        if bad:
            offenders.append(f"'{name}' ({''.join(bad)})")
    if offenders:
        forbidden = " ".join(_FORBIDDEN_ENTITY_TYPE_CHARS)
        raise ValueError(
            f"{source_label} field 'entity_types_guidance' uses entity type "
            "names with characters the extractor rejects (such entities are "
            f"dropped): {'; '.join(offenders)}. A type name must be a single "
            f"label containing none of: {forbidden} — split a compound like "
            "'参数/指标' into separate types '参数' and '指标'."
        )


def _validate_content(
    content: str,
    *,
    use_json: bool,
    source_label: str,
) -> tuple[dict[str, Any], ValidationResult]:
    try:
        profile = _load_prompt_profile_from_content(content, source_label)
        guidance = profile.get("entity_types_guidance")
        if guidance:
            _check_entity_type_names(guidance, source_label)
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


_ASSIST_EXAMPLE_SECTION_RE = re.compile(
    r"---Entity Types---.*?---Input Text---.*?---Output---(?P<output>.*)",
    re.DOTALL,
)
_JSON_ENTITY_KEYS = {"name", "type", "description"}
_JSON_RELATION_KEYS = {"source", "target", "keywords", "description"}


def _strip_assist_output_fence(output: str) -> str:
    """Drop an optional ```json fence the model may wrap the ---Output--- in."""
    body = output.strip()
    if body.startswith("```"):
        body = re.sub(r"\A```(?:json)?[ \t]*\n?", "", body)
        body = re.sub(r"\n?[ \t]*```\Z", "", body)
    return body.strip()


def _check_json_example_payload(
    payload: Any, *, index: int, field: str, source_label: str
) -> list[str]:
    """Enforce the JSON example shape: entities[]/relationships[] with the
    contract keys on every item."""
    prefix = f"{source_label} field '{field}' item {index} ---Output---"
    if not isinstance(payload, dict):
        return [f"{prefix} must be a single JSON object."]
    entities = payload.get("entities")
    relationships = payload.get("relationships")
    if not isinstance(entities, list) or not isinstance(relationships, list):
        return [f"{prefix} JSON must contain 'entities' and 'relationships' arrays."]
    errors: list[str] = []
    if any(
        not isinstance(entity, dict) or not _JSON_ENTITY_KEYS <= set(entity)
        for entity in entities
    ):
        errors.append(
            f"{prefix} has an entity missing required keys "
            f"{sorted(_JSON_ENTITY_KEYS)}."
        )
    if any(
        not isinstance(relation, dict) or not _JSON_RELATION_KEYS <= set(relation)
        for relation in relationships
    ):
        errors.append(
            f"{prefix} has a relationship missing required keys "
            f"{sorted(_JSON_RELATION_KEYS)}."
        )
    return errors


def _validate_assist_json_example_bodies(
    examples: list[Any], source_label: str
) -> list[str]:
    """Assist-only deep check: every JSON example's ---Output--- must be one
    valid JSON object carrying the contract shape.

    Core validation only checks the key exists and is non-empty; at extraction
    time these examples are concatenated as text (operate.py never parses them),
    so a malformed body would silently ship a low-quality few-shot. Because the
    assist endpoint *generates* these, it holds them to the full contract and
    lets the repair pass fix any failure.
    """
    field = "entity_extraction_json_examples"
    errors: list[str] = []
    for index, example in enumerate(examples):
        match = _ASSIST_EXAMPLE_SECTION_RE.search(str(example))
        if match is None:
            errors.append(
                f"{source_label} field '{field}' item {index} is missing the "
                "---Entity Types---/---Input Text---/---Output--- sections."
            )
            continue
        body = _strip_assist_output_fence(match.group("output"))
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, ValueError) as exc:
            errors.append(
                f"{source_label} field '{field}' item {index} ---Output--- is not "
                f"valid JSON ({exc.__class__.__name__})."
            )
            continue
        errors.extend(
            _check_json_example_payload(
                payload, index=index, field=field, source_label=source_label
            )
        )
    return errors


def _validate_content_all_modes(
    content: str,
    *,
    source_label: str,
) -> tuple[dict[str, Any], ValidationResult]:
    """Validate a draft against BOTH extraction modes at once.

    The assist endpoint generates every part regardless of
    ``ENTITY_EXTRACTION_USE_JSON``, so the draft must satisfy the text-mode
    contract (``entity_extraction_examples`` present + ``str.format``-safe) and
    the JSON-mode contract (``entity_extraction_json_examples`` present). On top
    of the core checks it also parses each JSON example body — see
    ``_validate_assist_json_example_bodies``. Errors are merged, de-duplicated,
    order-preserved.
    """
    profile_text, val_text = _validate_content(
        content, use_json=False, source_label=source_label
    )
    profile_json, val_json = _validate_content(
        content, use_json=True, source_label=source_label
    )
    errors = list(dict.fromkeys([*val_text.errors, *val_json.errors]))
    profile = profile_text or profile_json
    if profile:
        json_examples = profile.get("entity_extraction_json_examples") or []
        for err in _validate_assist_json_example_bodies(json_examples, source_label):
            if err not in errors:
                errors.append(err)
    return profile, ValidationResult(valid=not errors, errors=errors)


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
    "Row syntax (use the placeholder token `{tuple_delimiter}` verbatim as the "
    "field separator — do NOT replace it with any actual delimiter "
    "character):\n"
    "  entity{tuple_delimiter}NAME{tuple_delimiter}TYPE{tuple_delimiter}DESCRIPTION\n"
    "  relation{tuple_delimiter}SOURCE{tuple_delimiter}TARGET{tuple_delimiter}KEYWORDS{tuple_delimiter}DESCRIPTION\n"
    "Entity rows have exactly 4 fields; relation rows exactly 5. List all "
    "entity rows first, then all relation rows, and end every example with a "
    "line containing only the placeholder token `{completion_delimiter}`.\n"
    "The ONLY curly-brace tokens allowed inside `entity_extraction_examples` "
    "items are `{tuple_delimiter}` and `{completion_delimiter}`, written "
    "exactly like that. Do NOT introduce any other `{` or `}` characters."
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
    """Return the first built-in example verbatim, placeholders intact.

    Both modes show the example exactly as it lives in the profile —
    text-mode examples keep their ``{tuple_delimiter}`` / ``{completion_delimiter}``
    placeholders so the draft mirrors the sample-file convention.
    """
    key = (
        "entity_extraction_json_examples" if use_json else "entity_extraction_examples"
    )
    examples = default_profile.get(key) or []
    if not examples:
        return ""
    return str(examples[0]).rstrip()


def _build_prompt_assist_system_prompt(default_profile: dict[str, Any]) -> str:
    """Compose the assist system prompt.

    Always requires ALL profile parts — ``entity_types_guidance`` plus BOTH the
    text-mode (``entity_extraction_examples``) and JSON-mode
    (``entity_extraction_json_examples``) example lists — independent of the
    runtime ``ENTITY_EXTRACTION_USE_JSON`` setting, so one generated draft is
    usable in either extraction mode. Both format contracts and a rendered
    reference example per mode are embedded, with the full default guidance as a
    domain-adaptation baseline.
    """
    default_guidance = default_profile.get("entity_types_guidance", "").rstrip()
    text_reference = _render_assist_reference_example(default_profile, use_json=False)
    json_reference = _render_assist_reference_example(default_profile, use_json=True)
    return (
        "You are helping the user author a LightRAG entity extraction prompt "
        "profile. Return ONLY a YAML mapping. Do not wrap the output in "
        "markdown fences. Do not add any prose before or after the YAML.\n"
        "Write every multi-line value as a YAML literal block scalar — "
        "`key: |` (or `- |` for list items) followed by indented lines with "
        "REAL line breaks. Never emit `\\n` escape sequences or collapse a "
        "value into one quoted line.\n"
        "Required keys (ALL THREE are mandatory — never omit any):\n"
        "- `entity_types_guidance`: non-empty string — a short classification "
        "instruction followed by `- TypeName: description` bullet lines "
        "tailored to the user's domain. Each `TypeName` MUST be a single "
        "concise label and MUST NOT contain a separator or structural "
        "character — none of `/`, `\\`, `|`, `(`, `)`, `<`, `>`, `'`, or a "
        "comma (the extractor rejects any entity type containing these). "
        "Never join two concepts with a slash: split them into separate "
        "types or keep the dominant one (write `参数` and `指标` as separate "
        "types, NOT `参数/指标`). This rule applies to every TYPE token used "
        "in the examples as well.\n"
        "- `entity_extraction_examples`: list of 1-3 text-mode example strings "
        "following the TEXT format contract below.\n"
        "- `entity_extraction_json_examples`: list of 1-3 JSON-mode example "
        "strings following the JSON format contract below.\n"
        "The two example lists MUST cover the SAME sample passages: reuse the "
        "identical `---Entity Types---` and `---Input Text---` sections in both "
        "lists, differing ONLY in how the `---Output---` section is rendered "
        "(delimited rows vs. JSON object).\n\n"
        "TEXT format contract (entity_extraction_examples):\n"
        f"{_ASSIST_TEXT_FORMAT_RULES}\n\n"
        "JSON format contract (entity_extraction_json_examples):\n"
        f"{_ASSIST_JSON_FORMAT_RULES}\n\n"
        "Text-mode reference example — imitate the structure, adapt the content "
        "to the user's domain:\n"
        f"<reference_example>\n{text_reference}\n</reference_example>\n\n"
        "JSON-mode reference example — same structure, JSON output:\n"
        f"<json_reference_example>\n{json_reference}\n</json_reference_example>\n\n"
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
    _profile, repaired_validation = _validate_content_all_modes(
        repaired, source_label="assist draft"
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

    @router.delete(
        "/entity-type/{file_name}",
        response_model=PromptDeleteResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def delete_entity_type_prompt(file_name: str):
        workspace = _current_workspace(workspace_getter)
        try:
            path = resolve_prompt_file_for_workspace(file_name, workspace=workspace)
        except Exception as exc:
            raise _http_error_from_exception(exc) from exc

        # Built-in / shared files have no workspace prefix; they may be upstream
        # samples shared across workspaces, so they are not deletable here.
        if parse_workspace_prompt_file_name(path.name) is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Prompt file '{path.name}' is a shared/global profile and "
                    "cannot be deleted."
                ),
            )

        # Deleting the active file would leave a dangling reference; require an
        # explicit deactivate first instead of silently changing extraction.
        active_file = _active_file(rag)
        if path.name == active_file:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Prompt file '{path.name}' is active. Deactivate it before "
                    "deleting."
                ),
            )

        try:
            path.unlink()
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to delete prompt file '{path.name}': {exc}",
            ) from exc
        return PromptDeleteResponse(deleted_file=path.name, active_file=active_file)

    @router.post(
        "/entity-type/assist",
        response_model=PromptAssistResponse,
        dependencies=[Depends(combined_auth)],
    )
    async def assist_entity_type_prompt(request: PromptAssistRequest):
        llm_callable, model_name = _resolve_assist_llm(rag)
        default_profile = prompt_module.get_default_entity_extraction_prompt_profile()
        system_prompt = _build_prompt_assist_system_prompt(default_profile)
        user_prompt = _build_prompt_assist_user_prompt(request)
        raw_output = await _invoke_assist_llm(
            llm_callable,
            user_prompt=user_prompt,
            system_prompt=system_prompt,
        )
        cleaned = _strip_yaml_fence(raw_output)
        _profile, validation = _validate_content_all_modes(
            cleaned,
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
                warnings=warnings,
            )
        if validation.valid:
            # Re-serialize into readable block scalars so the editor shows real
            # line breaks instead of the LLM's escaped-'\n' quoted strings.
            cleaned = _normalize_profile_yaml(cleaned, "assist draft")
        return PromptAssistResponse(
            content=cleaned,
            validation=validation,
            warnings=warnings,
            raw_output=raw_output,
            model=model_name,
        )

    return router
