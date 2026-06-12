# Prompt Module Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the text-example format-validation gap, rewrite the entity-type prompt Assist meta-prompts with an explicit output contract + grounding + auto-repair, and fix the two misleading WebUI behaviors (activate/deactivate semantics, stale validation badge) plus the matching Assist panel inputs.

**Architecture:** Backend-first. A new format-check helper in `lightrag/prompt.py` is wired into `validate_entity_extraction_prompt_profile_for_mode` so every consumer (router `_validate_content`, `LightRAG._refresh_addon_params_cache`) fails fast on examples that would crash `str.format()` at extraction time (`lightrag/operate.py:3319`). The Assist meta-prompts in `lightrag/api/routers/prompt_routes.py` are rebuilt as pure functions (mode-directed required key, literal-delimiter format contract, rendered reference example, language resolution, `sample_text` grounding) with a one-shot server-side repair loop. The WebUI (`lightrag_webui/src/pages/Prompts.tsx`) gets two exported pure helpers (`promptActionForSelection`, `resolveValidationDisplay`) driving JSX fixes, plus Assist panel fields wired to the new request fields.

**Tech Stack:** Python 3.11+ / FastAPI / Pydantic v2 / pytest via `./scripts/test.sh`; React 19 + TypeScript via Bun test runner (`bun test`, vitest-compatible imports), i18next.

---

## Verified Facts (do not re-derive; trust these)

- `lightrag/operate.py:3311-3319`: text mode joins `prompt_profile["entity_extraction_examples"]` then calls `examples.format(tuple_delimiter=..., completion_delimiter=..., entity_types_guidance=..., language=...)`. **JSON examples are never `.format()`-ed** (`operate.py:3301` only joins them) — JSON example strings legitimately contain `{`/`}`. The format-check therefore applies ONLY to `entity_extraction_examples` and ONLY in text mode.
- `lightrag/prompt.py:901-936` `validate_entity_extraction_prompt_profile_for_mode(prompt_profile, use_json, prompt_file_name=None)` is called from `lightrag/api/routers/prompt_routes.py:287` (`_validate_content`) and `lightrag/lightrag.py:906` (`_refresh_addon_params_cache`). Wiring the check here covers save/activate/validate/assist/read routes AND env-configured profiles at refresh.
- Default text examples (`PROMPTS["entity_extraction_examples"]`) contain ONLY `{tuple_delimiter}`/`{completion_delimiter}` placeholders → they pass the 4-key format simulation. The WebUI preset (`lightrag_webui/src/features/promptPresets.ts`) pre-substitutes literal `<|#|>`/`<|COMPLETE|>` and contains no braces → passes.
- Assist meta-prompt builders live at `prompt_routes.py:447` (`_build_prompt_assist_system_prompt`) and `prompt_routes.py:475` (`_build_prompt_assist_user_prompt`). The assist endpoint body is at `prompt_routes.py:678-706`.
- Existing tests that MUST stay green (`tests/test_workspace_prompt_routes.py`, all `pytest.mark.offline`):
  - `test_assist_system_prompt_embeds_full_default_guidance` asserts default guidance verbatim + `"YAML"` + `"entity_types_guidance"` in the system prompt.
  - `test_assist_user_prompt_separates_requirements_from_current_content` asserts `<current_yaml>` tags and requirements before the tag.
  - `test_assist_entity_type_prompt_uses_runtime_llm_and_validates_output` asserts exactly 1 LLM call for a valid first draft (repair loop must not add calls when the draft validates).
  - `test_assist_entity_type_prompt_returns_validation_errors_for_invalid_yaml` uses a constant-return LLM; with the repair loop it will be called twice returning the same string — its assertions (`raw_output == raw`, `valid is False`) remain true. It does NOT assert call count.
  - Test helpers `_profile_content()` / `_text_profile_example()` produce YAML whose example contains literal `{tuple_delimiter}` / `{completion_delimiter}` placeholders → pass the format check.
- Test infra: `_DummyRAG`, `_AssistDummyRAG(role_query_func=..., llm_model_func=..., use_json=...)`, `_make_recording_llm(return_value)` (constant, Exception, or zero-arg callable), `_build_prompt_client(monkeypatch, rag)`. Every test starts with `monkeypatch.setattr(sys, "argv", [sys.argv[0]])` before importing `prompt_routes` (done inside `_build_prompt_client`; direct-import tests must do it themselves).
- Frontend: `bun test` runs `*.test.tsx` with vitest-compatible imports (`import { vi } from 'vitest'` works under Bun). `Prompts.test.tsx` mocks `@/api/lightrag` via `createLightragApiMock()` and tests exported pure helpers + `renderToStaticMarkup` shell assertions. `EntityTypePromptAssistRequest` type lives in `lightrag_webui/src/api/lightrag.ts:288-292`.
- i18n: only `en.json` and `zh.json` have a `prompts` section (other 9 locales fall back to inline fallback strings — acceptable, do not touch them).
- UI components available: `Select/SelectTrigger/SelectValue/SelectContent/SelectItem` from `@/components/ui/Select`; `Textarea`; lucide icons.
- Python env: `uv` only. Tests: `./scripts/test.sh <paths>`. Lint: `ruff check .`.

## File Structure

- Modify: `lightrag/prompt.py` — add `Sequence` import, `_TEXT_EXAMPLE_FORMAT_CONTEXT`, `ensure_text_examples_formattable()`; wire into `validate_entity_extraction_prompt_profile_for_mode`.
- Create: `tests/test_entity_extraction_prompt_format_check.py` — unit tests for the new helper + mode wiring.
- Modify: `lightrag/api/routers/prompt_routes.py` — rewrite assist meta-prompt builders, add `sample_text` to `PromptAssistRequest`, add `_ASSIST_LANGUAGE_NAMES`, `_ASSIST_TEXT_FORMAT_RULES`, `_ASSIST_JSON_FORMAT_RULES`, `_render_assist_reference_example`, `_build_prompt_assist_repair_prompt`, `_attempt_assist_repair`; update the assist endpoint.
- Modify: `tests/test_workspace_prompt_routes.py` — new router-level tests (format-check via endpoints, system/user prompt contracts, sample_text, repair loop) + `_make_sequence_llm` helper + `_json_profile_content` helper.
- Modify: `lightrag_webui/src/api/lightrag.ts` — extend `EntityTypePromptAssistRequest` with `sample_text`.
- Modify: `lightrag_webui/src/pages/Prompts.tsx` — extend `generateAssistDraft`; add `promptActionForSelection`, `resolveValidationDisplay` exports; `lastValidatedContent` state; activate/deactivate JSX; status JSX; assist panel fields (language select, sample text, char counter, warnings list).
- Modify: `lightrag_webui/src/pages/Prompts.test.tsx` — tests for the new helpers and request mapping.
- Modify: `lightrag_webui/src/locales/en.json`, `lightrag_webui/src/locales/zh.json` — new keys under `prompts.validation` and `prompts.assist`.

## Out of Scope (follow-up plans; do NOT implement here)

Dry-run extraction test endpoint + panel; `DELETE /prompts/entity-type/{file_name}`; assist draft diff preview; final-prompt preview tab; version auto-increment / overwrite warning; full i18n catch-up for the 9 remaining locales; additional domain presets; CodeMirror client-side YAML lint; import/export; `beforeunload` guard; replacing `window.confirm` with `AlertDialog`; assist streaming.

---

### Task 0: Branch

- [ ] **Step 0.1: Create the working branch**

```bash
cd /root/project/LightRAG
git checkout -b feat/prompt-module-optimization
```

---

### Task 1: Format-check helper in `lightrag/prompt.py`

**Files:**
- Modify: `lightrag/prompt.py` (imports at line 4; insert helper directly above `validate_entity_extraction_prompt_profile_for_mode` at line 901)
- Create: `tests/test_entity_extraction_prompt_format_check.py`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/test_entity_extraction_prompt_format_check.py`:

```python
from __future__ import annotations

import pytest

import lightrag.prompt as prompt_module


pytestmark = pytest.mark.offline


def test_default_text_examples_are_formattable():
    profile = prompt_module.get_default_entity_extraction_prompt_profile()
    # Must not raise: defaults only use the four allowed placeholders.
    prompt_module.ensure_text_examples_formattable(
        profile["entity_extraction_examples"], "default profile"
    )


def test_literal_delimiter_examples_pass():
    prompt_module.ensure_text_examples_formattable(
        ["entity<|#|>A<|#|>T<|#|>D\n<|COMPLETE|>"], "test"
    )


def test_placeholder_examples_pass():
    prompt_module.ensure_text_examples_formattable(
        [
            "entity{tuple_delimiter}A{tuple_delimiter}T{tuple_delimiter}D\n"
            "{completion_delimiter}"
        ],
        "test",
    )


@pytest.mark.parametrize(
    "bad_example",
    [
        "entity{tuple_delimiter}A{unknown_key}",  # KeyError
        "JSON-ish content { not a placeholder",  # ValueError: single '{'
        "positional {} placeholder",  # IndexError
    ],
)
def test_format_breaking_examples_fail_with_item_index(bad_example):
    with pytest.raises(ValueError) as excinfo:
        prompt_module.ensure_text_examples_formattable([bad_example], "src-label")
    message = str(excinfo.value)
    assert "item 0" in message
    assert "src-label" in message


def test_second_item_reported_with_its_index():
    with pytest.raises(ValueError) as excinfo:
        prompt_module.ensure_text_examples_formattable(
            ["fine example", "broken { example"], "src-label"
        )
    assert "item 1" in str(excinfo.value)


def test_validate_for_mode_rejects_format_breaking_text_example():
    profile = {
        "entity_types_guidance": "- T: t",
        "entity_extraction_examples": ["broken { example"],
        "entity_extraction_json_examples": [],
    }
    with pytest.raises(ValueError) as excinfo:
        prompt_module.validate_entity_extraction_prompt_profile_for_mode(
            profile, use_json=False, prompt_file_name="x.yml"
        )
    assert "x.yml" in str(excinfo.value)


def test_validate_for_mode_skips_text_check_in_json_mode():
    profile = {
        "entity_types_guidance": "- T: t",
        "entity_extraction_examples": ["broken { example"],
        "entity_extraction_json_examples": [
            '{"entities": [], "relationships": []}'
        ],
    }
    result = prompt_module.validate_entity_extraction_prompt_profile_for_mode(
        profile, use_json=True, prompt_file_name="x.yml"
    )
    assert result["entity_extraction_json_examples"]
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `cd /root/project/LightRAG && ./scripts/test.sh tests/test_entity_extraction_prompt_format_check.py`
Expected: FAIL — `AttributeError: module 'lightrag.prompt' has no attribute 'ensure_text_examples_formattable'`

- [ ] **Step 1.3: Implement the helper**

In `lightrag/prompt.py`, change line 4 import:

```python
from typing import Any, Mapping, Sequence, TypedDict
```

Insert immediately above `def validate_entity_extraction_prompt_profile_for_mode(` (line 901):

```python
_TEXT_EXAMPLE_FORMAT_CONTEXT: dict[str, str] = {
    "tuple_delimiter": PROMPTS["DEFAULT_TUPLE_DELIMITER"],
    "completion_delimiter": PROMPTS["DEFAULT_COMPLETION_DELIMITER"],
    "entity_types_guidance": "",
    "language": "English",
}


def ensure_text_examples_formattable(
    examples: Sequence[str], source_label: str
) -> None:
    """Fail fast when a text-mode example would break str.format() at extraction.

    operate.py renders ``entity_extraction_examples`` with
    ``examples.format(tuple_delimiter=..., completion_delimiter=...,
    entity_types_guidance=..., language=...)``. A stray ``{``/``}`` or an
    unknown placeholder only raises there — after save/activate already
    succeeded. Run the same substitution here so validation reports the
    problem instead of the indexing pipeline.
    """

    for index, example in enumerate(examples):
        try:
            example.format(**_TEXT_EXAMPLE_FORMAT_CONTEXT)
        except (KeyError, IndexError, ValueError) as exc:
            raise ValueError(
                f"{source_label} field 'entity_extraction_examples' item {index} "
                f"is not format-safe ({exc.__class__.__name__}: {exc}). Only the "
                "placeholders {tuple_delimiter}, {completion_delimiter}, "
                "{entity_types_guidance} and {language} are allowed; any other "
                "curly braces must be doubled ('{{' / '}}') or removed."
            ) from exc
```

Then rewrite `validate_entity_extraction_prompt_profile_for_mode` (hoist the source label, add the mode-scoped check). Final function body:

```python
def validate_entity_extraction_prompt_profile_for_mode(
    prompt_profile: Mapping[str, Any],
    use_json: bool,
    prompt_file_name: str | None = None,
) -> EntityExtractionPromptProfile:
    """Validate that the resolved profile contains the active-mode examples."""

    source = (
        f"ENTITY_TYPE_PROMPT_FILE '{prompt_file_name}'"
        if prompt_file_name
        else "the resolved prompt profile"
    )
    required_examples_key = (
        "entity_extraction_json_examples" if use_json else "entity_extraction_examples"
    )
    if (
        required_examples_key not in prompt_profile
        or not prompt_profile[required_examples_key]
    ):
        mode_name = "json" if use_json else "text"
        raise ValueError(
            f"{source} must define '{required_examples_key}' when entity extraction "
            f"runs in {mode_name} mode."
        )

    if not use_json:
        # JSON examples legitimately contain '{'/'}' and are never formatted;
        # only text-mode examples pass through str.format() in operate.py.
        ensure_text_examples_formattable(
            [str(example) for example in prompt_profile["entity_extraction_examples"]],
            source,
        )

    return {
        "entity_types_guidance": str(prompt_profile["entity_types_guidance"]).rstrip(),
        "entity_extraction_examples": [
            str(example).rstrip()
            for example in prompt_profile["entity_extraction_examples"]
        ],
        "entity_extraction_json_examples": [
            str(example).rstrip()
            for example in prompt_profile["entity_extraction_json_examples"]
        ],
    }
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_entity_extraction_prompt_format_check.py`
Expected: 9 passed (the parametrized test counts as 3)

- [ ] **Step 1.5: Run regression suites that exercise the validator**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py tests/extraction`
Expected: all pass (existing `_profile_content` fixtures use only allowed placeholders)

- [ ] **Step 1.6: Commit**

```bash
git add lightrag/prompt.py tests/test_entity_extraction_prompt_format_check.py
git commit -m "fix(prompt): fail validation for format-breaking text examples"
```

---

### Task 2: Router-level coverage for the format check

**Files:**
- Modify: `tests/test_workspace_prompt_routes.py` (append tests; add one helper near `_profile_content`)

- [ ] **Step 2.1: Add the JSON profile helper**

Insert after `_profile_content` (line 36):

```python
def _json_profile_content() -> str:
    return (
        "entity_types_guidance: |\n"
        "  - ExampleType: Test type\n"
        "entity_extraction_examples:\n"
        "  - |\n"
        "    broken { example\n"
        "entity_extraction_json_examples:\n"
        "  - |\n"
        '    {"entities": [], "relationships": []}\n'
    )
```

- [ ] **Step 2.2: Write the failing/passing router tests**

Append to `tests/test_workspace_prompt_routes.py`:

```python
def test_validate_endpoint_reports_format_breaking_example(monkeypatch):
    rag = _DummyRAG()
    client = _build_prompt_client(monkeypatch, rag)

    content = (
        "entity_types_guidance: |\n"
        "  - T: t\n"
        "entity_extraction_examples:\n"
        "  - |\n"
        "    entity<|#|>A<|#|>T<|#|>D {stray\n"
        "    <|COMPLETE|>\n"
    )
    response = client.post(
        "/prompts/entity-type/validate",
        json={"content": content, "use_json": False},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert "item 0" in body["errors"][0]


def test_save_endpoint_rejects_format_breaking_example(monkeypatch, tmp_path):
    prompt_dir = tmp_path / "entity_type"
    prompt_dir.mkdir()
    rag = _DummyRAG()
    client = _build_prompt_client(monkeypatch, rag)

    content = (
        "entity_types_guidance: |\n"
        "  - T: t\n"
        "entity_extraction_examples:\n"
        "  - |\n"
        "    entity<|#|>A<|#|>T<|#|>D {stray\n"
        "    <|COMPLETE|>\n"
    )
    with patch("lightrag.prompt.get_entity_type_prompt_dir", return_value=prompt_dir):
        response = client.put(
            "/prompts/entity-type/entity-type/versions/1",
            json={"content": content, "activate": False},
        )

    assert response.status_code == 400
    # Nothing was written: validation rejected the payload before _atomic_write.
    assert not list(prompt_dir.iterdir())


def test_validate_endpoint_json_mode_ignores_text_example_braces(monkeypatch):
    rag = _DummyRAG(use_json=True)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/validate",
        json={"content": _json_profile_content()},
    )

    assert response.status_code == 200
    assert response.json()["valid"] is True
```

- [ ] **Step 2.3: Run the file**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py`
Expected: all pass (Task 1 already wired the check; these lock the router behavior)

- [ ] **Step 2.4: Commit**

```bash
git add tests/test_workspace_prompt_routes.py
git commit -m "test(api): lock prompt-route behavior for format-breaking examples"
```

---

### Task 3: Assist system prompt rewrite

**Files:**
- Modify: `lightrag/api/routers/prompt_routes.py` (replace `_build_prompt_assist_system_prompt` at lines 447-472; add constants + `_render_assist_reference_example` above it)
- Modify: `tests/test_workspace_prompt_routes.py`

- [ ] **Step 3.1: Write the failing tests**

Append to `tests/test_workspace_prompt_routes.py`:

```python
def test_assist_system_prompt_text_mode_contract(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    import lightrag.prompt as prompt_module
    from lightrag.api.routers.prompt_routes import _build_prompt_assist_system_prompt

    default_profile = prompt_module.get_default_entity_extraction_prompt_profile()
    sp = _build_prompt_assist_system_prompt(False, default_profile)

    # Active-mode key is REQUIRED (no "either/or" choice left to the LLM).
    assert "never omit `entity_extraction_examples`" in sp
    # Concrete row syntax with literal delimiters.
    assert "entity<|#|>NAME<|#|>TYPE<|#|>DESCRIPTION" in sp
    assert "relation<|#|>SOURCE<|#|>TARGET<|#|>KEYWORDS<|#|>DESCRIPTION" in sp
    assert "<|COMPLETE|>" in sp
    # Brace ban for text-mode examples.
    assert "Do NOT use curly braces" in sp
    # Reference example embedded, rendered with literal delimiters.
    assert "<reference_example>" in sp
    ref = sp.split("<reference_example>", 1)[1].split("</reference_example>", 1)[0]
    assert "<|#|>" in ref
    assert "{tuple_delimiter}" not in ref
    # Default guidance baseline kept verbatim.
    assert default_profile["entity_types_guidance"].rstrip() in sp


def test_assist_system_prompt_json_mode_contract(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    import lightrag.prompt as prompt_module
    from lightrag.api.routers.prompt_routes import _build_prompt_assist_system_prompt

    default_profile = prompt_module.get_default_entity_extraction_prompt_profile()
    sp = _build_prompt_assist_system_prompt(True, default_profile)

    assert "never omit `entity_extraction_json_examples`" in sp
    assert "`entities` and `relationships`" in sp
    assert "<reference_example>" in sp
    # JSON reference example is the default one, verbatim.
    ref = sp.split("<reference_example>", 1)[1].split("</reference_example>", 1)[0]
    assert default_profile["entity_extraction_json_examples"][0].rstrip() == ref.strip()
```

- [ ] **Step 3.2: Run to verify failure**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py -k assist_system_prompt`
Expected: the two new tests FAIL (old prompt lacks the contract markers); `test_assist_system_prompt_embeds_full_default_guidance` still passes

- [ ] **Step 3.3: Implement**

In `lightrag/api/routers/prompt_routes.py`, replace the whole `_build_prompt_assist_system_prompt` function (lines 447-472) with:

```python
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
```

- [ ] **Step 3.4: Run the assist tests**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py -k assist`
Expected: all pass, including `test_assist_system_prompt_embeds_full_default_guidance`

- [ ] **Step 3.5: Commit**

```bash
git add lightrag/api/routers/prompt_routes.py tests/test_workspace_prompt_routes.py
git commit -m "feat(api): rewrite assist system prompt with explicit format contract"
```

---

### Task 4: Assist user prompt — language resolution + `sample_text`

**Files:**
- Modify: `lightrag/api/routers/prompt_routes.py` (`PromptAssistRequest` at lines 116-124; `_build_prompt_assist_user_prompt` at lines 475-493)
- Modify: `tests/test_workspace_prompt_routes.py`

- [ ] **Step 4.1: Write the failing tests**

Append to `tests/test_workspace_prompt_routes.py`:

```python
def test_assist_user_prompt_language_resolution(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api.routers.prompt_routes import (
        PromptAssistRequest,
        _build_prompt_assist_user_prompt,
    )

    auto = _build_prompt_assist_user_prompt(PromptAssistRequest(requirements="r"))
    # "auto" is resolved to an instruction the LLM can act on, never passed raw.
    assert "same language as the requirements" in auto
    assert "Generation language: auto" not in auto

    zh = _build_prompt_assist_user_prompt(
        PromptAssistRequest(requirements="r", language="zh")
    )
    assert "Write the draft in Chinese." in zh


def test_assist_user_prompt_embeds_sample_text_block(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api.routers.prompt_routes import (
        PromptAssistRequest,
        _build_prompt_assist_user_prompt,
    )

    prompt = _build_prompt_assist_user_prompt(
        PromptAssistRequest(requirements="r", sample_text="corpus snippet")
    )
    assert "<sample_text>" in prompt
    assert "</sample_text>" in prompt
    assert "corpus snippet" in prompt

    without = _build_prompt_assist_user_prompt(PromptAssistRequest(requirements="r"))
    assert "<sample_text>" not in without


def test_assist_rejects_overlong_sample_text(monkeypatch):
    rag = _AssistDummyRAG(role_query_func=_make_recording_llm("ignored"))
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "ok", "sample_text": "z" * 8001},
    )
    assert response.status_code == 422
```

- [ ] **Step 4.2: Run to verify failure**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py -k "assist_user_prompt or overlong_sample"`
Expected: new tests FAIL (`sample_text` unknown field → pydantic `extra="forbid"` error; language line missing)

- [ ] **Step 4.3: Implement**

In `prompt_routes.py`, add to `PromptAssistRequest` (after `current_content`):

```python
    sample_text: str | None = Field(default=None, max_length=8000)
```

Replace `_build_prompt_assist_user_prompt` entirely with:

```python
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
```

- [ ] **Step 4.4: Run the assist tests**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py -k assist`
Expected: all pass (incl. `test_assist_user_prompt_separates_requirements_from_current_content`)

- [ ] **Step 4.5: Commit**

```bash
git add lightrag/api/routers/prompt_routes.py tests/test_workspace_prompt_routes.py
git commit -m "feat(api): assist language resolution and sample_text grounding"
```

---

### Task 5: One-shot auto-repair loop + meaningful `warnings`

**Files:**
- Modify: `lightrag/api/routers/prompt_routes.py` (add `_build_prompt_assist_repair_prompt`, `_attempt_assist_repair` after `_invoke_assist_llm`; rewrite the `assist_entity_type_prompt` endpoint body at lines 678-706)
- Modify: `tests/test_workspace_prompt_routes.py`

- [ ] **Step 5.1: Write the failing tests**

Append to `tests/test_workspace_prompt_routes.py`:

```python
def _make_sequence_llm(responses):
    """Recording LLM returning queued responses; raises queued exceptions."""
    remaining = list(responses)

    def _next():
        value = remaining.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    return _make_recording_llm(_next)


def test_assist_repairs_invalid_draft_once(monkeypatch):
    good = _profile_content(label="Repaired")
    llm = _make_sequence_llm(["not: [valid", good])
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist", json={"requirements": "any"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["validation"]["valid"] is True
    assert body["content"].rstrip() == good.rstrip()
    assert len(llm.calls) == 2
    repair_call = llm.calls[1]
    assert "<previous_draft>" in repair_call["prompt"]
    assert "not: [valid" in repair_call["prompt"]
    assert body["warnings"]


def test_assist_repair_gives_up_after_one_attempt(monkeypatch):
    llm = _make_sequence_llm(["still: [broken", "again: [broken"])
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist", json={"requirements": "any"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["validation"]["valid"] is False
    assert len(llm.calls) == 2
    # The latest attempt is returned for UI debugging.
    assert body["raw_output"] == "again: [broken"
    assert body["warnings"]


def test_assist_repair_call_failure_falls_back_to_first_draft(monkeypatch):
    bad = "broken: [yaml"
    llm = _make_sequence_llm([bad, ConnectionError("repair upstream died")])
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist", json={"requirements": "any"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["validation"]["valid"] is False
    assert body["raw_output"] == bad
    assert any("repair" in warning.lower() for warning in body["warnings"])


def test_assist_valid_first_draft_skips_repair_and_has_no_warnings(monkeypatch):
    llm = _make_recording_llm(_profile_content(label="Clean"))
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist", json={"requirements": "any"}
    )

    assert response.status_code == 200
    assert len(llm.calls) == 1
    assert response.json()["warnings"] == []
```

- [ ] **Step 5.2: Run to verify failure**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py -k repair`
Expected: FAIL — only one LLM call happens; `warnings` is always `[]`

- [ ] **Step 5.3: Implement**

In `prompt_routes.py`, insert after `_invoke_assist_llm`:

```python
def _build_prompt_assist_repair_prompt(
    previous_draft: str, errors: list[str]
) -> str:
    """Feed validation errors back for a single corrective retry."""
    error_lines = "\n".join(f"- {error}" for error in errors)
    return (
        "Your previous draft failed validation.\n\n"
        f"Validation errors:\n{error_lines}\n\n"
        f"<previous_draft>\n{previous_draft.rstrip()}\n</previous_draft>\n\n"
        "Fix the errors and return the corrected YAML mapping only. Do not "
        "add any prose or markdown fences."
    )


async def _attempt_assist_repair(
    llm_callable: Callable[..., Any],
    *,
    system_prompt: str,
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
    repair_prompt = _build_prompt_assist_repair_prompt(draft, validation.errors)
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
```

Replace the `assist_entity_type_prompt` endpoint body with:

```python
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
```

- [ ] **Step 5.4: Run the full backend prompt suite + lint**

Run: `./scripts/test.sh tests/test_workspace_prompt_routes.py tests/test_entity_extraction_prompt_format_check.py && ruff check lightrag/`
Expected: all pass; ruff clean. Note: `test_assist_entity_type_prompt_returns_validation_errors_for_invalid_yaml` now triggers 2 LLM calls returning the same constant — its assertions still hold.

- [ ] **Step 5.5: Commit**

```bash
git add lightrag/api/routers/prompt_routes.py tests/test_workspace_prompt_routes.py
git commit -m "feat(api): auto-repair invalid assist drafts once and surface warnings"
```

---

### Task 6: WebUI API types + `generateAssistDraft` extension

**Files:**
- Modify: `lightrag_webui/src/api/lightrag.ts` (type at lines 288-292)
- Modify: `lightrag_webui/src/pages/Prompts.tsx` (`generateAssistDraft` at lines 231-242)
- Modify: `lightrag_webui/src/pages/Prompts.test.tsx`

- [ ] **Step 6.1: Write the failing tests**

In `Prompts.test.tsx`, append inside `describe('Prompts assist draft', ...)`:

```ts
  test('generateAssistDraft forwards sample text and non-auto language', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')

    ;(api.assistEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'entity_types_guidance: drafted\n',
      validation: { valid: true, errors: [] },
      warnings: [],
      raw_output: 'entity_types_guidance: drafted\n',
      model: 'm'
    })

    await page.generateAssistDraft({
      requirements: 'medical',
      currentContent: '',
      sampleText: 'patient record snippet',
      language: 'zh'
    })

    expect(api.assistEntityTypePrompt).toHaveBeenCalledWith({
      requirements: 'medical',
      sample_text: 'patient record snippet',
      language: 'zh'
    })
  })

  test('generateAssistDraft omits auto language and blank sample text', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')

    ;(api.assistEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: '',
      validation: { valid: false, errors: ['empty'] },
      warnings: [],
      raw_output: '',
      model: null
    })

    await page.generateAssistDraft({
      requirements: 'r',
      currentContent: '',
      sampleText: '',
      language: 'auto'
    })

    expect(api.assistEntityTypePrompt).toHaveBeenCalledWith({ requirements: 'r' })
  })
```

- [ ] **Step 6.2: Run to verify failure**

Run: `cd /root/project/LightRAG/lightrag_webui && bun test src/pages/Prompts.test.tsx`
Expected: 2 new tests FAIL (unexpected call shape / unknown params ignored)

- [ ] **Step 6.3: Implement**

`lightrag_webui/src/api/lightrag.ts` — replace the request type:

```ts
export type EntityTypePromptAssistRequest = {
  requirements: string
  current_content?: string
  sample_text?: string
  language?: EntityTypePromptAssistLanguage
}
```

`lightrag_webui/src/pages/Prompts.tsx` — replace `generateAssistDraft`:

```ts
/**
 * Pure helper that wraps the API client and strips empty optional fields.
 * Keeping the request shape minimal lets the backend apply its own defaults
 * (language="auto", use_json from runtime config).
 */
export const generateAssistDraft = async (params: {
  requirements: string
  currentContent: string
  sampleText?: string
  language?: EntityTypePromptAssistLanguage
}): Promise<AssistDraftResponse> => {
  const request: EntityTypePromptAssistRequest = {
    requirements: params.requirements
  }
  if (params.currentContent) {
    request.current_content = params.currentContent
  }
  if (params.sampleText) {
    request.sample_text = params.sampleText
  }
  if (params.language && params.language !== 'auto') {
    request.language = params.language
  }
  return await assistEntityTypePrompt(request)
}
```

Add `EntityTypePromptAssistLanguage` to the type imports from `@/api/lightrag` in `Prompts.tsx` (extend the existing `import { ... } from '@/api/lightrag'` block with `type EntityTypePromptAssistLanguage`).

- [ ] **Step 6.4: Run the tests**

Run: `bun test src/pages/Prompts.test.tsx src/api/lightrag.prompts.test.ts`
Expected: all pass (existing "posts only provided fields" / "omits current_content" tests stay green)

- [ ] **Step 6.5: Commit**

```bash
cd /root/project/LightRAG
git add lightrag_webui/src/api/lightrag.ts lightrag_webui/src/pages/Prompts.tsx lightrag_webui/src/pages/Prompts.test.tsx
git commit -m "feat(webui): assist request supports sample text and language"
```

---

### Task 7: Activate/Deactivate follows the SELECTED file

**Files:**
- Modify: `lightrag_webui/src/pages/Prompts.tsx` (new exported helper near `formatPromptFileMeta`; JSX at lines 845-864)
- Modify: `lightrag_webui/src/pages/Prompts.test.tsx`

Rationale: today the button renders `Deactivate` whenever ANY file is active (`state.list.active_file`), even while the user is viewing a different, inactive file — clicking it deactivates an unrelated file. The action must key off the selected file.

- [ ] **Step 7.1: Write the failing test**

Append to `Prompts.test.tsx` (new describe block at file end):

```ts
describe('Prompt activation semantics', () => {
  test('promptActionForSelection keys off the selected file, not global active state', async () => {
    const page = await import('./Prompts')

    // Nothing selected → offer activate (disabled by the button itself).
    expect(page.promptActionForSelection(null)).toBe('activate')
    // Selected file is inactive → activate it (even if another file is active).
    expect(page.promptActionForSelection(workspaceFile({ active: false }))).toBe('activate')
    // Selected file is the active one → offer deactivate.
    expect(page.promptActionForSelection(workspaceFile({ active: true }))).toBe('deactivate')
  })
})
```

- [ ] **Step 7.2: Run to verify failure**

Run: `bun test src/pages/Prompts.test.tsx`
Expected: FAIL — `promptActionForSelection` is not exported

- [ ] **Step 7.3: Implement**

In `Prompts.tsx`, add after `formatPromptFileMeta` (line 222):

```ts
export const promptActionForSelection = (
  selectedFile: EntityTypePromptFile | null
): 'activate' | 'deactivate' => (selectedFile?.active ? 'deactivate' : 'activate')
```

Replace the JSX block (current lines 845-864):

```tsx
              {state.list.active_file ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleDeactivate()}
                >
                  <XCircleIcon aria-hidden="true" />
                  <span>{t('prompts.deactivate', 'Deactivate')}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!state.selectedFileName || saving}
                  onClick={() => void handleActivate()}
                >
                  <PlayIcon aria-hidden="true" />
                  <span>{saving ? t('common.saving', 'Saving...') : t('prompts.activate', 'Activate')}</span>
                </Button>
              )}
```

with:

```tsx
              {promptActionForSelection(selectedFile) === 'deactivate' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleDeactivate()}
                >
                  <XCircleIcon aria-hidden="true" />
                  <span>{t('prompts.deactivate', 'Deactivate')}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!state.selectedFileName || saving}
                  onClick={() => void handleActivate()}
                >
                  <PlayIcon aria-hidden="true" />
                  <span>{saving ? t('common.saving', 'Saving...') : t('prompts.activate', 'Activate')}</span>
                </Button>
              )}
```

Note: `activateSelectedPrompt` already handles the switch-while-another-is-active case correctly (it rebuilds `files[].active` from `response.active_file`), so activating an inactive file while a different one is active is a single click — no behavioral backend change needed.

- [ ] **Step 7.4: Run the tests**

Run: `bun test src/pages/Prompts.test.tsx`
Expected: all pass (shell test still finds "Activate" in default render — no selection → activate branch)

- [ ] **Step 7.5: Commit**

```bash
git add lightrag_webui/src/pages/Prompts.tsx lightrag_webui/src/pages/Prompts.test.tsx
git commit -m "fix(webui): activate/deactivate follows the selected prompt file"
```

---

### Task 8: Stale-validation indicator

**Files:**
- Modify: `lightrag_webui/src/pages/Prompts.tsx`
- Modify: `lightrag_webui/src/pages/Prompts.test.tsx`

Rationale: the green "Prompt is valid" badge persists while the user edits the YAML; the badge must reflect that the displayed validation no longer matches the editor content.

- [ ] **Step 8.1: Write the failing test**

Append to `Prompts.test.tsx`:

```ts
describe('Validation display state', () => {
  test('resolveValidationDisplay distinguishes valid/invalid/stale/none', async () => {
    const page = await import('./Prompts')
    const v = (valid: boolean, errors: string[] = []) => ({ valid, errors })

    // Never validated (preset / blank / after deactivate) → no badge.
    expect(
      page.resolveValidationDisplay({ validation: v(false), content: 'a', lastValidatedContent: null })
    ).toBe('none')
    // Content matches what was validated → trust the result.
    expect(
      page.resolveValidationDisplay({ validation: v(true), content: 'a', lastValidatedContent: 'a' })
    ).toBe('valid')
    expect(
      page.resolveValidationDisplay({ validation: v(false, ['e']), content: 'a', lastValidatedContent: 'a' })
    ).toBe('invalid')
    // Edited since validation → stale, regardless of the old verdict.
    expect(
      page.resolveValidationDisplay({ validation: v(true), content: 'b', lastValidatedContent: 'a' })
    ).toBe('stale')
    expect(
      page.resolveValidationDisplay({ validation: v(false, ['e']), content: 'b', lastValidatedContent: 'a' })
    ).toBe('stale')
  })
})
```

- [ ] **Step 8.2: Run to verify failure**

Run: `bun test src/pages/Prompts.test.tsx`
Expected: FAIL — `resolveValidationDisplay` not exported

- [ ] **Step 8.3: Implement the helper**

In `Prompts.tsx`, add after `promptActionForSelection`:

```ts
export type ValidationDisplay = 'valid' | 'invalid' | 'stale' | 'none'

/**
 * The validation result only describes `lastValidatedContent`. Once the
 * editor diverges from it the verdict is stale; with no validated content
 * at all (preset / blank / post-deactivate) there is nothing to show.
 */
export const resolveValidationDisplay = (params: {
  validation: EntityTypePromptValidation
  content: string
  lastValidatedContent: string | null
}): ValidationDisplay => {
  if (params.lastValidatedContent === null) {
    return 'none'
  }
  if (params.content !== params.lastValidatedContent) {
    return 'stale'
  }
  return params.validation.valid ? 'valid' : 'invalid'
}
```

- [ ] **Step 8.4: Wire component state**

All edits inside the `Prompts()` component of `Prompts.tsx`:

1. Add state after `const [savedContent, setSavedContent] = useState('')`:

```ts
  const [lastValidatedContent, setLastValidatedContent] = useState<string | null>(null)
```

2. In `load()`: in the `if (!hasFiles)` branch add `setLastValidatedContent(null)`; in the `else` branch add `setLastValidatedContent(nextState.content)`; in the `catch` branch add `setLastValidatedContent(null)`.

3. In `handleSelect`: after `setSavedContent(nextState.content)` add `setLastValidatedContent(nextState.content)`.

4. In `handleLoadPreset`: after `setSavedContent(preset.content)` add `setLastValidatedContent(null)`.

5. In `handleNewBlank`: after `setSavedContent('')` add `setLastValidatedContent(null)`.

6. In `handleValidate`: capture content before the await and record it after — replace the body's first lines:

```ts
  const handleValidate = useCallback(async () => {
    const validatedContent = state.content
    try {
      const nextState = await validatePromptContent(state)
      setState(nextState)
      setLastValidatedContent(validatedContent)
      if (nextState.validation.valid) {
```

(rest unchanged).

7. In `handleSave`: after `setSavedContent(nextState.content)` add `setLastValidatedContent(nextState.content)`.

8. In `handleActivate`: activation validates the stored FILE, not the editor buffer — only sync when they match:

```ts
  const handleActivate = useCallback(async () => {
    try {
      const nextState = await activateSelectedPrompt(state)
      setState(nextState)
      if (!hasUnsavedChanges) {
        setLastValidatedContent(state.content)
      }
      toast.success(t('prompts.activated', 'Prompt activated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [hasUnsavedChanges, state, t])
```

9. In `handleDeactivate`: after `setState(nextState)` add `setLastValidatedContent(null)`.

10. In `handleApplyAssistDraft`: after `setState((previous) => applyAssistDraft(previous, assistDraft))` add `setLastValidatedContent(assistDraft.content)`.

- [ ] **Step 8.5: Wire the status JSX**

Add inside the component body (before `return`):

```ts
  const validationDisplay = resolveValidationDisplay({
    validation: state.validation,
    content: state.content,
    lastValidatedContent
  })
```

Replace the status block (currently lines 811-838, the `<div className="min-w-0 text-sm">` contents):

```tsx
            <div className="min-w-0 text-sm">
              {validationDisplay === 'valid' ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <CheckCircle2Icon className="size-4" aria-hidden="true" />
                  {t('prompts.validation.valid', 'Prompt is valid')}
                </span>
              ) : validationDisplay === 'invalid' && state.validation.errors.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1 text-destructive cursor-pointer"
                  onClick={() => setValidationDialogOpen(true)}
                >
                  <XCircleIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{state.validation.errors[0]}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ({state.validation.errors.length})
                  </span>
                </button>
              ) : validationDisplay === 'stale' ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertCircleIcon className="size-4" aria-hidden="true" />
                  {t('prompts.validation.stale', 'Edited since last validation')}
                </span>
              ) : selectedFile ? (
                <span className="text-muted-foreground">
                  {formatPromptFileTitle(selectedFile)} · {formatPromptFileMeta(selectedFile)}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {t('prompts.newFile', 'New workspace prompt')}
                </span>
              )}
            </div>
```

Add `AlertCircleIcon` to the lucide import at the top of `Prompts.tsx`.

- [ ] **Step 8.6: Run the tests**

Run: `bun test src/pages/Prompts.test.tsx`
Expected: all pass (shell test unchanged: initial state has `lastValidatedContent=null` → 'none' → "New workspace prompt" fallback renders as before)

- [ ] **Step 8.7: Commit**

```bash
git add lightrag_webui/src/pages/Prompts.tsx lightrag_webui/src/pages/Prompts.test.tsx
git commit -m "feat(webui): mark stale validation state in prompt editor"
```

---

### Task 9: Assist panel — language select, sample text, char counter, warnings

**Files:**
- Modify: `lightrag_webui/src/pages/Prompts.tsx`

- [ ] **Step 9.1: Add imports and state**

In `Prompts.tsx`:

1. Add to imports:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
```

2. Add component state after `const [assistRequirements, setAssistRequirements] = useState('')`:

```ts
  const [assistLanguage, setAssistLanguage] = useState<EntityTypePromptAssistLanguage>('auto')
  const [assistSampleText, setAssistSampleText] = useState('')
```

3. Update `handleGenerateAssistDraft` to forward them:

```ts
      const response = await generateAssistDraft({
        requirements: assistRequirements,
        currentContent: state.content,
        sampleText: assistSampleText,
        language: assistLanguage
      })
```

and extend the dependency array to `[assistLanguage, assistLoading, assistRequirements, assistSampleText, state.content, t]`.

- [ ] **Step 9.2: Extend the assist panel JSX**

1. On the requirements `<Textarea>` add `maxLength={4000}`, and insert a counter right after the `<Textarea>` (inside the same `<label>`):

```tsx
                <span className="text-right text-xs text-muted-foreground">
                  {assistRequirements.length}/4000
                </span>
```

2. Insert after the closing `</label>` of the requirements field (before the generate-button row):

```tsx
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('prompts.assist.languageLabel', 'Generation language')}
                  </span>
                  <Select
                    value={assistLanguage}
                    onValueChange={(value) =>
                      setAssistLanguage(value as EntityTypePromptAssistLanguage)
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {t('prompts.assist.languageAuto', 'Auto (match requirements)')}
                      </SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="zh">中文</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('prompts.assist.sampleTextLabel', 'Sample text (optional)')}
                </span>
                <Textarea
                  value={assistSampleText}
                  maxLength={8000}
                  onChange={(event) => setAssistSampleText(event.target.value)}
                  placeholder={t(
                    'prompts.assist.sampleTextPlaceholder',
                    'Paste a representative passage from your corpus; generated examples will be grounded in it'
                  )}
                  className="min-h-[64px]"
                />
              </label>
```

3. Render backend warnings — insert directly after the `draftMeta` `<div>` inside the `assistDraft && (...)` block:

```tsx
                  {assistDraft.warnings.length > 0 && (
                    <ul className="list-inside list-disc text-xs text-amber-600 dark:text-amber-400">
                      {assistDraft.warnings.map((warning, idx) => (
                        <li key={idx}>{warning}</li>
                      ))}
                    </ul>
                  )}
```

- [ ] **Step 9.3: Run tests + lint**

Run: `bun test src/pages/Prompts.test.tsx && bun run lint`
Expected: tests pass; ESLint clean

- [ ] **Step 9.4: Commit**

```bash
git add lightrag_webui/src/pages/Prompts.tsx
git commit -m "feat(webui): assist panel language, sample text and warnings"
```

---

### Task 10: i18n keys (en + zh only)

**Files:**
- Modify: `lightrag_webui/src/locales/en.json` (`prompts.validation` at ~line 965; `prompts.assist` at ~line 970)
- Modify: `lightrag_webui/src/locales/zh.json` (same sections)

- [ ] **Step 10.1: en.json**

In `prompts.validation` add:

```json
      "stale": "Edited since last validation"
```

In `prompts.assist` add (after `"requirementsPlaceholder"`):

```json
      "languageLabel": "Generation language",
      "languageAuto": "Auto (match requirements)",
      "sampleTextLabel": "Sample text (optional)",
      "sampleTextPlaceholder": "Paste a representative passage from your corpus; generated examples will be grounded in it",
```

- [ ] **Step 10.2: zh.json**

In `prompts.validation` add:

```json
      "stale": "内容已修改，尚未重新校验"
```

In `prompts.assist` add (after `"requirementsPlaceholder"`):

```json
      "languageLabel": "生成语言",
      "languageAuto": "自动（跟随需求语言）",
      "sampleTextLabel": "样例文本（可选）",
      "sampleTextPlaceholder": "粘贴一段有代表性的语料，生成的示例将以其为素材",
```

- [ ] **Step 10.3: Validate JSON + commit**

Run: `bun test src/pages/Prompts.test.tsx` (i18n JSON parse errors would break the import chain) and visually confirm both files are valid JSON (trailing commas are illegal).

```bash
git add lightrag_webui/src/locales/en.json lightrag_webui/src/locales/zh.json
git commit -m "feat(webui): i18n keys for prompt editor additions"
```

---

### Task 11: Final verification sweep

- [ ] **Step 11.1: Backend**

```bash
cd /root/project/LightRAG
./scripts/test.sh tests/test_workspace_prompt_routes.py tests/test_entity_extraction_prompt_format_check.py tests/extraction
ruff check .
```

Expected: all tests pass; ruff clean.

- [ ] **Step 11.2: Frontend**

```bash
cd /root/project/LightRAG/lightrag_webui
bun test src/pages/Prompts.test.tsx src/api/lightrag.prompts.test.ts
bun run lint
```

Expected: all tests pass; ESLint clean.

- [ ] **Step 11.3: Type-check the webui build**

```bash
cd /root/project/LightRAG/lightrag_webui && bun run build
```

Expected: build succeeds (tsc + vite). This catches the `EntityTypePromptAssistLanguage` import and JSX edits.

- [ ] **Step 11.4: Report**

Report pass counts for each suite. Do NOT merge or push; stop and hand back to the user per repo policy.

---

## Global Acceptance Checks (for post-implementation verification)

1. `POST /prompts/entity-type/validate` with a text-mode example containing a stray `{` returns `valid=false` with an error naming the item index. Same content via `PUT .../versions/{n}` returns 400 and writes nothing.
2. JSON-mode validation never format-checks `entity_extraction_examples` (JSON braces stay legal).
3. `_build_prompt_assist_system_prompt(False, ...)` contains: required-key sentence for `entity_extraction_examples`, literal row syntax with `<|#|>`, `<|COMPLETE|>`, the brace ban, a `<reference_example>` block with literal delimiters, and the full default guidance.
4. `_build_prompt_assist_user_prompt` never emits the raw token `auto`; `sample_text` appears inside `<sample_text>` tags; `current_content` stays inside `<current_yaml>`.
5. Assist endpoint: invalid first draft → exactly one repair call (`<previous_draft>` in its prompt), `warnings` non-empty; valid first draft → one call, `warnings == []`; repair-call failure → original draft returned with a repair warning.
6. WebUI: with file A active and inactive file B selected, the action button reads "Activate" and activates B in one click; only when the selected file is itself active does it read "Deactivate".
7. WebUI: editing the YAML after a successful validation switches the green badge to the amber stale indicator; re-validating restores it.
8. `generateAssistDraft` omits `language` when `'auto'` and omits empty `sample_text`/`current_content`.
