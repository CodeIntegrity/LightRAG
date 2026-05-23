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


class _DummyRAG:
    def __init__(self, *, use_json: bool = False, active_file: str | None = None):
        self.entity_extraction_use_json = use_json
        self.addon_params = {}
        if active_file is not None:
            self.addon_params["entity_type_prompt_file"] = active_file
        self.refresh_count = 0

    def _refresh_addon_params_cache(self) -> None:
        self.refresh_count += 1


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
