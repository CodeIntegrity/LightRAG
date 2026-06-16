from __future__ import annotations

import sys
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


pytestmark = pytest.mark.offline


def _text_profile_example(label: str = "Example") -> str:
    return f"""---Entity Types---
- ExampleType: Test type

---Input Text---
```
{label}
```

---Output---
entity{{tuple_delimiter}}{label}{{tuple_delimiter}}ExampleType{{tuple_delimiter}}{label} description.
{{completion_delimiter}}"""


def _json_profile_example(label: str = "Example") -> str:
    return f"""---Entity Types---
- ExampleType: Test type

---Input Text---
```
{label}
```

---Output---
{{
  "entities": [
    {{"name": "{label}", "type": "ExampleType", "description": "{label} description."}}
  ],
  "relationships": []
}}"""


def _profile_content(*, label: str = "Example") -> str:
    """A full profile valid in BOTH extraction modes (text + JSON examples).

    The assist endpoint now always generates every part, so its success-path
    fixtures must satisfy the combined text-and-JSON validation.
    """
    return (
        "entity_types_guidance: |\n"
        "  - ExampleType: Test type\n"
        "entity_extraction_examples:\n"
        "  - |\n"
        + "\n".join(f"    {line}" for line in _text_profile_example(label).splitlines())
        + "\n"
        "entity_extraction_json_examples:\n"
        "  - |\n"
        + "\n".join(f"    {line}" for line in _json_profile_example(label).splitlines())
        + "\n"
    )


def _text_only_profile_content(*, label: str = "Example") -> str:
    return (
        "entity_types_guidance: |\n"
        "  - ExampleType: Test type\n"
        "entity_extraction_examples:\n"
        "  - |\n"
        + "\n".join(f"    {line}" for line in _text_profile_example(label).splitlines())
        + "\n"
    )


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


def _assert_same_profile(actual: str, expected: str) -> None:
    """Assert two drafts carry the same profile, ignoring serialization style.

    The assist endpoint re-serializes validated output into sample-style block
    scalars, so byte-equality no longer holds; semantic equality does.
    """
    from lightrag.api.routers.prompt_routes import _load_prompt_profile_from_content

    assert _load_prompt_profile_from_content(
        actual, "actual"
    ) == _load_prompt_profile_from_content(expected, "expected")


class _DummyRAG:
    def __init__(self, *, use_json: bool = False, active_file: str | None = None):
        self.entity_extraction_use_json = use_json
        self.addon_params = {}
        if active_file is not None:
            self.addon_params["entity_type_prompt_file"] = active_file
        self.refresh_count = 0

    def _refresh_addon_params_cache(self) -> None:
        self.refresh_count += 1


class _AssistDummyRAG(_DummyRAG):
    """DummyRAG variant exposing role_llm_funcs / llm_model_func for assist tests."""

    def __init__(
        self,
        *,
        use_json: bool = False,
        active_file: str | None = None,
        role_query_func=None,
        llm_model_func=None,
        model_name: str = "dummy-model",
    ):
        super().__init__(use_json=use_json, active_file=active_file)
        # role_llm_funcs only includes "query" when explicitly provided so we
        # can also exercise the capability-missing path.
        self.role_llm_funcs: dict[str, object] = {}
        if role_query_func is not None:
            self.role_llm_funcs["query"] = role_query_func
        self.llm_model_func = llm_model_func
        self.llm_model_name = model_name
        self.llm_calls: list[dict] = []


def _make_recording_llm(return_value):
    """Build an async LLM callable that records its invocation kwargs."""

    calls: list[dict] = []

    async def _llm(prompt, system_prompt=None, history_messages=None, **kwargs):
        calls.append(
            {
                "prompt": prompt,
                "system_prompt": system_prompt,
                "history_messages": history_messages,
                "kwargs": kwargs,
            }
        )
        if isinstance(return_value, Exception):
            raise return_value
        if callable(return_value):
            return return_value()
        return return_value

    _llm.calls = calls  # type: ignore[attr-defined]
    return _llm


def _build_prompt_client(monkeypatch, rag: _DummyRAG) -> TestClient:
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api.routers import prompt_routes

    monkeypatch.setattr(
        prompt_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )

    app = FastAPI()
    app.include_router(
        prompt_routes.create_prompt_routes(
            rag,
            api_key=None,
            workspace_getter=lambda: "default",
        )
    )
    return TestClient(app)


def test_workspace_prompt_file_name_helpers_reject_unsafe_names(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api.routers.prompt_routes import (
        build_workspace_prompt_file_name,
        parse_workspace_prompt_file_name,
        resolve_prompt_file_for_workspace,
    )

    parsed = parse_workspace_prompt_file_name("default--entity-type--v1.yml")
    assert parsed.workspace == "default"
    assert parsed.prompt_slug == "entity-type"
    assert parsed.version == 1

    assert build_workspace_prompt_file_name("default", "entity-type", 2) == (
        "default--entity-type--v2.yml"
    )

    prompt_dir = tmp_path / "entity_type"
    prompt_dir.mkdir()
    (prompt_dir / "default--entity-type--v1.yml").write_text(
        _profile_content(), encoding="utf-8"
    )
    (prompt_dir / "other--entity-type--v1.yml").write_text(
        _profile_content(), encoding="utf-8"
    )
    (prompt_dir / "foo.yml").write_text(_profile_content(), encoding="utf-8")

    with patch("lightrag.prompt.get_entity_type_prompt_dir", return_value=prompt_dir):
        assert (
            resolve_prompt_file_for_workspace(
                "default--entity-type--v1.yml", workspace="default"
            ).name
            == "default--entity-type--v1.yml"
        )
        assert (
            resolve_prompt_file_for_workspace("foo.yml", workspace="default").name
            == "foo.yml"
        )
        with pytest.raises(ValueError):
            resolve_prompt_file_for_workspace(
                "other--entity-type--v1.yml", workspace="default"
            )
        with pytest.raises(ValueError):
            resolve_prompt_file_for_workspace("../x.yml", workspace="default")
        with pytest.raises(ValueError):
            resolve_prompt_file_for_workspace("bad.txt", workspace="default")


def test_prompt_routes_list_read_validate_save_activate_workspace_files(
    monkeypatch, tmp_path
):
    prompt_dir = tmp_path / "entity_type"
    prompt_dir.mkdir()
    (prompt_dir / "default--entity-type--v1.yml").write_text(
        _profile_content(label="Default One"), encoding="utf-8"
    )
    (prompt_dir / "other--entity-type--v1.yml").write_text(
        _profile_content(label="Other One"), encoding="utf-8"
    )
    (prompt_dir / "foo.yml").write_text(
        _profile_content(label="Global One"), encoding="utf-8"
    )
    rag = _DummyRAG(active_file="default--entity-type--v1.yml")
    client = _build_prompt_client(monkeypatch, rag)

    with patch("lightrag.prompt.get_entity_type_prompt_dir", return_value=prompt_dir):
        list_response = client.get("/prompts/entity-type")
        assert list_response.status_code == 200
        list_body = list_response.json()
        assert list_body["workspace"] == "default"
        assert list_body["active_file"] == "default--entity-type--v1.yml"
        file_names = [item["file_name"] for item in list_body["files"]]
        assert file_names == ["default--entity-type--v1.yml", "foo.yml"]
        by_name = {item["file_name"]: item for item in list_body["files"]}
        assert by_name["default--entity-type--v1.yml"]["active"] is True
        assert by_name["default--entity-type--v1.yml"]["source"] == "workspace"
        assert by_name["foo.yml"]["source"] == "global"

        read_response = client.get("/prompts/entity-type/default--entity-type--v1.yml")
        assert read_response.status_code == 200
        read_body = read_response.json()
        assert "Default One" in read_body["content"]
        assert read_body["validation"]["valid"] is True

        forbidden_response = client.get(
            "/prompts/entity-type/other--entity-type--v1.yml"
        )
        assert forbidden_response.status_code == 400

        invalid_response = client.post(
            "/prompts/entity-type/validate",
            json={"content": "entity_extraction_examples: nope\n", "use_json": False},
        )
        assert invalid_response.status_code == 200
        assert invalid_response.json()["valid"] is False

        valid_response = client.post(
            "/prompts/entity-type/validate",
            json={"content": _profile_content(label="Saved One"), "use_json": False},
        )
        assert valid_response.status_code == 200
        assert valid_response.json()["valid"] is True

        save_response = client.put(
            "/prompts/entity-type/entity-type/versions/2",
            json={"content": _profile_content(label="Saved One"), "activate": True},
        )
        assert save_response.status_code == 200
        save_body = save_response.json()
        assert save_body["file"]["file_name"] == "default--entity-type--v2.yml"
        assert save_body["file"]["active"] is True
        assert (prompt_dir / "default--entity-type--v2.yml").exists()
        assert rag.addon_params["entity_type_prompt_file"] == (
            "default--entity-type--v2.yml"
        )
        assert rag.refresh_count == 1

        activate_response = client.post(
            "/prompts/entity-type/activate",
            json={"file_name": "foo.yml"},
        )
        assert activate_response.status_code == 200
        assert activate_response.json()["active_file"] == "foo.yml"
        assert rag.addon_params["entity_type_prompt_file"] == "foo.yml"
        assert rag.refresh_count == 2

        deactivate_response = client.post("/prompts/entity-type/deactivate")
        assert deactivate_response.status_code == 200
        deactivate_body = deactivate_response.json()
        assert deactivate_body["active_file"] is None
        assert deactivate_body["previous_file"]["file_name"] == "foo.yml"
        assert "entity_type_prompt_file" not in rag.addon_params
        assert rag.refresh_count == 3


def test_delete_entity_type_prompt_removes_workspace_file(monkeypatch, tmp_path):
    prompt_dir = tmp_path / "entity_type"
    prompt_dir.mkdir()
    (prompt_dir / "default--entity-type--v1.yml").write_text(
        _profile_content(label="Active"), encoding="utf-8"
    )
    (prompt_dir / "default--entity-type--v2.yml").write_text(
        _profile_content(label="Spare"), encoding="utf-8"
    )
    (prompt_dir / "other--entity-type--v1.yml").write_text(
        _profile_content(label="Other WS"), encoding="utf-8"
    )
    (prompt_dir / "foo.yml").write_text(_profile_content(), encoding="utf-8")
    rag = _DummyRAG(active_file="default--entity-type--v1.yml")
    client = _build_prompt_client(monkeypatch, rag)

    with patch("lightrag.prompt.get_entity_type_prompt_dir", return_value=prompt_dir):
        # Happy path: a workspace-owned, non-active file is removed from disk.
        ok = client.delete("/prompts/entity-type/default--entity-type--v2.yml")
        assert ok.status_code == 200
        assert ok.json() == {
            "deleted_file": "default--entity-type--v2.yml",
            "active_file": "default--entity-type--v1.yml",
        }
        assert not (prompt_dir / "default--entity-type--v2.yml").exists()

        # Missing file -> 404.
        missing = client.delete("/prompts/entity-type/default--entity-type--v9.yml")
        assert missing.status_code == 404

        # Active file is protected (409) and stays on disk.
        active = client.delete("/prompts/entity-type/default--entity-type--v1.yml")
        assert active.status_code == 409
        assert (prompt_dir / "default--entity-type--v1.yml").exists()

        # Global/shared file is not deletable (403).
        global_file = client.delete("/prompts/entity-type/foo.yml")
        assert global_file.status_code == 403
        assert (prompt_dir / "foo.yml").exists()

        # Another workspace's file is rejected (400) and untouched.
        cross = client.delete("/prompts/entity-type/other--entity-type--v1.yml")
        assert cross.status_code == 400
        assert (prompt_dir / "other--entity-type--v1.yml").exists()


def test_prompt_routes_include_in_server_runtime_binding(monkeypatch, tmp_path):
    import tests.test_workspace_runtime_app_integration as runtime_tests

    monkeypatch.setattr(
        runtime_tests._DummyRAG,
        "register_role_llm_builder",
        lambda self, builder: None,
        raising=False,
    )
    monkeypatch.setattr(
        runtime_tests._DummyRAG,
        "addon_params",
        {},
        raising=False,
    )
    monkeypatch.setattr(
        runtime_tests._DummyRAG,
        "entity_extraction_use_json",
        False,
        raising=False,
    )
    monkeypatch.setattr(
        runtime_tests._DummyRAG,
        "_refresh_addon_params_cache",
        lambda self: None,
        raising=False,
    )

    monkeypatch.setenv("PROMPT_DIR", str(tmp_path / "prompts"))
    app = runtime_tests._build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=False,
        include_graph_routes=False,
        default_workspace="default",
    )

    with TestClient(app) as client:
        response = client.put(
            "/prompts/entity-type/entity-type/versions/1",
            json={"content": _profile_content(label="Runtime Bound"), "activate": True},
            headers={"LIGHTRAG-WORKSPACE": "default"},
        )

    assert response.status_code == 200
    assert response.json()["file"]["file_name"] == "default--entity-type--v1.yml"


def test_assist_entity_type_prompt_uses_runtime_llm_and_validates_output(monkeypatch):
    yaml_payload = _profile_content(label="Assist OK")
    llm = _make_recording_llm(yaml_payload)
    rag = _AssistDummyRAG(role_query_func=llm, model_name="role-query-model")
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={
            "requirements": "请为通用文档抽取人物、组织和地点",
            "current_content": _profile_content(label="Current"),
            "language": "zh",
        },
    )

    assert response.status_code == 200
    body = response.json()
    _assert_same_profile(body["content"], yaml_payload)
    # Output is normalized into sample-style block scalars, not the LLM's raw form.
    assert "entity_extraction_examples:\n  - |" in body["content"]
    assert body["validation"]["valid"] is True
    assert body["raw_output"] == yaml_payload
    assert body["model"] == "role-query-model"
    # Exactly one LLM call, with stream disabled.
    assert len(llm.calls) == 1
    call = llm.calls[0]
    assert call["kwargs"].get("stream") is False
    assert call["system_prompt"]
    assert "请为通用文档抽取人物、组织和地点" in call["prompt"]


def test_assist_entity_type_prompt_returns_503_when_llm_capability_missing(monkeypatch):
    rag = _AssistDummyRAG()  # neither role_llm_funcs["query"] nor llm_model_func
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "anything"},
    )

    assert response.status_code == 503


def test_assist_entity_type_prompt_returns_502_when_llm_call_raises(monkeypatch):
    llm = _make_recording_llm(ConnectionError("upstream provider died: secret=abc"))
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "anything"},
    )

    assert response.status_code == 502
    detail = str(response.json())
    # Provider-internal error details must not leak through the response.
    assert "secret=abc" not in detail
    assert "upstream provider died" not in detail


def test_assist_entity_type_prompt_returns_500_when_llm_returns_non_string(monkeypatch):
    llm = _make_recording_llm({"unexpected": "dict"})
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "anything"},
    )

    assert response.status_code == 500


def test_assist_entity_type_prompt_returns_validation_errors_for_invalid_yaml(monkeypatch):
    raw = "not yaml at all: {{{ unbalanced"
    llm = _make_recording_llm(raw)
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "anything"},
    )

    # The endpoint itself succeeds; validation reports the failure. raw_output
    # reflects the latest attempt (here both attempts return the same constant).
    assert response.status_code == 200
    body = response.json()
    assert body["validation"]["valid"] is False
    assert body["raw_output"] == raw


def test_assist_entity_type_prompt_falls_back_to_llm_model_func(monkeypatch):
    """role_llm_funcs.get('query') is preferred; llm_model_func is the fallback."""
    yaml_payload = _profile_content(label="Fallback OK")
    llm = _make_recording_llm(yaml_payload)
    rag = _AssistDummyRAG(llm_model_func=llm, model_name="fallback-model")
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "anything"},
    )

    assert response.status_code == 200
    assert len(llm.calls) == 1
    assert response.json()["model"] == "fallback-model"


def test_assist_system_prompt_embeds_full_default_guidance(monkeypatch):
    import lightrag.prompt as prompt_module

    yaml_payload = _profile_content(label="OK")
    llm = _make_recording_llm(yaml_payload)
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "any"},
    )
    assert response.status_code == 200

    default_profile = prompt_module.get_default_entity_extraction_prompt_profile()
    default_guidance = default_profile["entity_types_guidance"].rstrip()
    system_prompt = llm.calls[0]["system_prompt"]
    # Full default guidance is embedded verbatim (not a summary), so tests
    # don't drift when guidance copy changes.
    assert default_guidance in system_prompt
    # Output contract is stated.
    assert "YAML" in system_prompt
    assert "entity_types_guidance" in system_prompt


def test_assist_user_prompt_separates_requirements_from_current_content(monkeypatch):
    yaml_payload = _profile_content(label="OK")
    llm = _make_recording_llm(yaml_payload)
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    requirements = "Generate medical entity types"
    current = _profile_content(label="Current Baseline")
    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": requirements, "current_content": current},
    )
    assert response.status_code == 200

    prompt = llm.calls[0]["prompt"]
    # current_content must live inside <current_yaml> tags, not mixed into
    # the requirements section.
    assert "<current_yaml>" in prompt
    assert "</current_yaml>" in prompt
    assert current.rstrip() in prompt
    # The block boundary keeps requirements and current_content distinct.
    pre_tag, _, _post = prompt.partition("<current_yaml>")
    assert requirements in pre_tag
    assert current.rstrip() not in pre_tag


def test_assist_strips_yaml_fence_from_llm_output(monkeypatch):
    yaml_body = _profile_content(label="Fenced")
    fenced = f"```yaml\n{yaml_body.rstrip()}\n```"
    llm = _make_recording_llm(fenced)
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "any"},
    )

    assert response.status_code == 200
    body = response.json()
    # Cleaned content drops the outer ```yaml...``` wrapper. (Inner ``` from
    # the YAML examples themselves are allowed.)
    assert not body["content"].lstrip().startswith("```")
    assert not body["content"].rstrip().endswith("```")
    _assert_same_profile(body["content"], yaml_body)
    # raw_output preserves the original LLM response unchanged.
    assert body["raw_output"] == fenced
    assert body["validation"]["valid"] is True


def test_assist_rejects_overlong_requirements(monkeypatch):
    rag = _AssistDummyRAG(role_query_func=_make_recording_llm("ignored"))
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "x" * 5000},
    )
    assert response.status_code == 422


def test_assist_rejects_overlong_current_content(monkeypatch):
    rag = _AssistDummyRAG(role_query_func=_make_recording_llm("ignored"))
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={
            "requirements": "ok",
            "current_content": "y" * 30001,
        },
    )
    assert response.status_code == 422


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


def test_assist_system_prompt_requires_all_parts_both_modes(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    import lightrag.prompt as prompt_module
    from lightrag.api.routers.prompt_routes import _build_prompt_assist_system_prompt

    default_profile = prompt_module.get_default_entity_extraction_prompt_profile()
    # Signature no longer takes use_json: every part is generated regardless.
    sp = _build_prompt_assist_system_prompt(default_profile)

    # All three keys are mandatory — no "either/or" mode choice left to the LLM.
    assert "ALL THREE are mandatory" in sp
    assert "entity_types_guidance" in sp
    assert "entity_extraction_examples" in sp
    assert "entity_extraction_json_examples" in sp
    # Both example lists must cover the same sample passages.
    assert "SAME sample passages" in sp

    # TEXT contract: concrete row syntax with placeholder delimiters.
    assert (
        "entity{tuple_delimiter}NAME{tuple_delimiter}TYPE{tuple_delimiter}DESCRIPTION"
        in sp
    )
    assert (
        "relation{tuple_delimiter}SOURCE{tuple_delimiter}TARGET"
        "{tuple_delimiter}KEYWORDS{tuple_delimiter}DESCRIPTION" in sp
    )
    assert "{completion_delimiter}" in sp
    assert "ONLY curly-brace tokens allowed" in sp

    # JSON contract.
    assert "`entities` and `relationships`" in sp
    # Root-cause guard: drafts must use real line breaks, not '\n' escapes.
    assert "literal block scalar" in sp
    # Root-cause guard: generated TypeNames must not carry separator/structural
    # characters the extractor rejects (e.g. the slash in `参数/指标`).
    assert "Never join two concepts with a slash" in sp

    # Text reference example embedded, placeholders kept intact (not substituted).
    text_ref = sp.split("<reference_example>", 1)[1].split("</reference_example>", 1)[0]
    assert "{tuple_delimiter}" in text_ref
    assert "<|#|>" not in text_ref
    # JSON reference example is the default one, verbatim.
    json_ref = sp.split("<json_reference_example>", 1)[1].split(
        "</json_reference_example>", 1
    )[0]
    assert default_profile["entity_extraction_json_examples"][0].rstrip() == json_ref.strip()

    # Default guidance baseline kept verbatim.
    assert default_profile["entity_types_guidance"].rstrip() in sp


def test_normalize_profile_yaml_rewrites_quoted_scalars_as_blocks(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    import yaml

    from lightrag.api.routers.prompt_routes import _normalize_profile_yaml

    # Mirrors a real assist draft: single-quoted guidance keeps '\n' LITERAL
    # (no real break), while the double-quoted example decodes '\n' to breaks.
    ugly = (
        "entity_types_guidance: '从记录提取实体。\\n\\n- 设备: 关键部件。'\n"
        "entity_extraction_json_examples:\n"
        '- "---Entity Types---\\n- 设备: 关键部件。\\n\\n---Output---\\n'
        '{\\n  \\"entities\\": []\\n}"\n'
    )
    out = _normalize_profile_yaml(ugly, "assist draft")

    # Sample-style block scalars, no escaped newlines left behind.
    assert "entity_types_guidance: |" in out
    assert "\n  - |" in out
    assert "\\n" not in out
    # The broken single-quoted guidance recovered real line breaks.
    reparsed = yaml.safe_load(out)
    assert "\n" in reparsed["entity_types_guidance"]
    assert "设备" in reparsed["entity_types_guidance"]
    # JSON example content and structure survive the round-trip.
    assert '"entities"' in reparsed["entity_extraction_json_examples"][0]


def test_normalize_profile_yaml_passes_through_unparseable(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api.routers.prompt_routes import _normalize_profile_yaml

    broken = "entity_types_guidance: [unterminated\n"
    # Unparseable content is returned untouched (callers only normalize valid drafts).
    assert _normalize_profile_yaml(broken, "assist draft") == broken



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


def test_assist_accepts_deprecated_use_json_but_still_requires_both_modes(monkeypatch):
    """`use_json` is accepted for old clients but no longer controls output shape."""
    repaired = _profile_content(label="Compat Repaired")
    llm = _make_sequence_llm(
        [_text_only_profile_content(label="Text Only"), repaired]
    )
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist",
        json={"requirements": "any", "use_json": False},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["validation"]["valid"] is True
    _assert_same_profile(body["content"], repaired)
    assert len(llm.calls) == 2
    assert "entity_extraction_json_examples" in llm.calls[1]["prompt"]


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
    _assert_same_profile(body["content"], good)
    assert len(llm.calls) == 2
    repair_call = llm.calls[1]
    assert "<previous_draft>" in repair_call["prompt"]
    assert "not: [valid" in repair_call["prompt"]
    assert "<original_request>" in repair_call["prompt"]
    assert "any" in repair_call["prompt"]
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


def _profile_with_json_output(json_output: str, *, label: str = "Example") -> str:
    """Full profile with a valid text example and a JSON example whose
    ---Output--- body is ``json_output`` verbatim (for exercising deep checks)."""
    json_example = (
        "---Entity Types---\n"
        "- ExampleType: Test type\n\n"
        "---Input Text---\n"
        "```\n"
        f"{label}\n"
        "```\n\n"
        "---Output---\n"
        f"{json_output}"
    )
    return (
        "entity_types_guidance: |\n"
        "  - ExampleType: Test type\n"
        "entity_extraction_examples:\n"
        "  - |\n"
        + "\n".join(f"    {line}" for line in _text_profile_example(label).splitlines())
        + "\n"
        "entity_extraction_json_examples:\n"
        "  - |\n"
        + "\n".join(f"    {line}" for line in json_example.splitlines())
        + "\n"
    )


def test_validate_all_modes_rejects_malformed_json_example_body(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    from lightrag.api.routers.prompt_routes import _validate_content_all_modes

    content = _profile_with_json_output("{not valid json,,}")
    _profile, validation = _validate_content_all_modes(content, source_label="draft")

    assert validation.valid is False
    assert any("is not valid JSON" in e for e in validation.errors)


def test_validate_rejects_slash_in_entity_type_name(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    from lightrag.api.routers.prompt_routes import _validate_content_all_modes

    # A '/' in the type NAME is exactly what the extractor drops (e.g. 参数/指标).
    content = _profile_content().replace(
        "  - ExampleType: Test type", "  - 参数/指标: 量化数据"
    )
    _profile, validation = _validate_content_all_modes(content, source_label="draft")

    assert validation.valid is False
    assert any("参数/指标" in e for e in validation.errors)
    # Merged across both modes, the single guidance error is not duplicated.
    assert (
        sum("entity type names with characters" in e for e in validation.errors) == 1
    )


def test_validate_allows_slash_only_in_type_description(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    from lightrag.api.routers.prompt_routes import _validate_content_all_modes

    # The rule targets the type NAME only; a slash inside the description is
    # legitimate and must not trip a false positive.
    content = _profile_content().replace(
        "  - ExampleType: Test type", "  - ExampleType: handles input/output data"
    )
    _profile, validation = _validate_content_all_modes(content, source_label="draft")

    assert validation.valid is True
    assert validation.errors == []


def test_validate_all_modes_rejects_json_example_missing_keys(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    from lightrag.api.routers.prompt_routes import _validate_content_all_modes

    # Entity is missing the required "description" key.
    body = '{"entities": [{"name": "A", "type": "ExampleType"}], "relationships": []}'
    _profile, validation = _validate_content_all_modes(
        _profile_with_json_output(body), source_label="draft"
    )

    assert validation.valid is False
    assert any("entity missing required keys" in e for e in validation.errors)


def test_validate_all_modes_rejects_json_example_without_arrays(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    from lightrag.api.routers.prompt_routes import _validate_content_all_modes

    body = '{"foo": "bar"}'
    _profile, validation = _validate_content_all_modes(
        _profile_with_json_output(body), source_label="draft"
    )

    assert validation.valid is False
    assert any("'entities' and 'relationships' arrays" in e for e in validation.errors)


def test_validate_all_modes_accepts_fenced_json_example_output(monkeypatch):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    from lightrag.api.routers.prompt_routes import _validate_content_all_modes

    # Model may wrap the ---Output--- JSON in a ```json fence; deep check strips it.
    fenced = (
        "```json\n"
        '{"entities": [{"name": "A", "type": "ExampleType", "description": "d"}], '
        '"relationships": []}\n'
        "```"
    )
    _profile, validation = _validate_content_all_modes(
        _profile_with_json_output(fenced), source_label="draft"
    )

    assert validation.valid is True, validation.errors


def test_assist_endpoint_repairs_malformed_json_example_body(monkeypatch):
    """A draft that passes core validation but has an unparseable JSON example
    output must still fail and trigger the one-shot repair."""
    bad = _profile_with_json_output("{broken json")
    good = _profile_content(label="Repaired")
    llm = _make_sequence_llm([bad, good])
    rag = _AssistDummyRAG(role_query_func=llm)
    client = _build_prompt_client(monkeypatch, rag)

    response = client.post(
        "/prompts/entity-type/assist", json={"requirements": "any"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["validation"]["valid"] is True
    assert len(llm.calls) == 2
    # The repair prompt was fed the JSON-body error.
    assert "valid JSON" in llm.calls[1]["prompt"]
    assert body["warnings"]
