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


def _profile_content(*, label: str = "Example") -> str:
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
    assert body["content"].rstrip() == yaml_payload.rstrip()
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

    # The endpoint itself succeeds; the validation result reports the failure
    # and raw_output preserves the original LLM response for UI debugging.
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
    assert body["content"].rstrip() == yaml_body.rstrip()
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
