import sys
import types
from types import SimpleNamespace

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from lightrag.prompt_version_store import PromptVersionStore


pytestmark = pytest.mark.offline


class _DummyGraphStorage:
    def __init__(self, workspace: str):
        self.workspace = workspace

    async def get_popular_labels(self, limit: int):
        return [f"{self.workspace}:popular:{limit}"]


class _DummyRAG:
    def __init__(self, *args, **kwargs):
        self.ollama_server_infos = kwargs.get("ollama_server_infos")
        self.working_dir = kwargs["working_dir"]
        self.workspace = kwargs.get("workspace", "")
        self.prompt_version_store = PromptVersionStore(
            kwargs["working_dir"], workspace=self.workspace
        )
        self.chunk_entity_relation_graph = _DummyGraphStorage(self.workspace or "default")

    async def initialize_storages(self):
        return None

    async def check_and_migrate_data(self):
        return None

    async def finalize_storages(self):
        return None

    async def get_graph_labels(self):
        return [self.workspace or "default"]


class _DummyOllamaAPI:
    def __init__(self, rag, top_k=60, api_key=None):
        self.router = APIRouter()


def _build_token(username: str, role: str) -> str:
    from lightrag.api.auth import auth_handler

    return auth_handler.create_token(username, role=role)


@pytest.fixture
def graph_test_client(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api import config as api_config
    from lightrag.api import lightrag_server

    monkeypatch.setattr(lightrag_server, "LightRAG", _DummyRAG)
    monkeypatch.setattr(lightrag_server, "OllamaAPI", _DummyOllamaAPI)
    monkeypatch.setattr(
        lightrag_server, "create_document_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(
        lightrag_server, "create_query_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(lightrag_server, "check_frontend_build", lambda: (False, False))
    monkeypatch.setattr(
        lightrag_server, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )
    import lightrag.api.routers.workspace_routes as workspace_routes

    monkeypatch.setattr(
        workspace_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )
    monkeypatch.setattr(
        lightrag_server, "global_args", SimpleNamespace(cors_origins="*")
    )
    monkeypatch.setattr(lightrag_server, "cleanup_keyed_lock", lambda: {})
    monkeypatch.setattr(lightrag_server, "get_default_workspace", lambda: "")
    fake_ollama_module = types.ModuleType("lightrag.llm.ollama")

    async def _fake_ollama_model_complete(*args, **kwargs):
        return "ok"

    async def _fake_ollama_embed(*args, **kwargs):
        return []

    fake_ollama_module.ollama_model_complete = _fake_ollama_model_complete
    fake_ollama_module.ollama_embed = _fake_ollama_embed
    monkeypatch.setitem(sys.modules, "lightrag.llm.ollama", fake_ollama_module)

    async def _fake_get_namespace_data(*args, **kwargs):
        return {"busy": False}

    monkeypatch.setattr(lightrag_server, "get_namespace_data", _fake_get_namespace_data)

    args = api_config.parse_args()
    args.working_dir = str(tmp_path / "rag_storage")
    args.input_dir = str(tmp_path / "inputs")
    args.workspace = ""
    args.workspace_registry_path = str(tmp_path / "workspaces" / "registry.sqlite3")
    app = lightrag_server.create_app(args)
    with TestClient(app) as client:
        yield client


def test_graph_routes_resolve_runtime_from_workspace_header(graph_test_client):
    create_response = graph_test_client.post(
        "/workspaces",
        json={
            "workspace": "ws1",
            "display_name": "Workspace 1",
            "description": "graph test",
            "visibility": "public",
        },
        headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
    )

    assert create_response.status_code == 201

    response = graph_test_client.get(
        "/graph/label/list", headers={"LIGHTRAG-WORKSPACE": "ws1"}
    )

    assert response.status_code == 200
    assert response.json() == ["ws1"]


def test_create_app_does_not_require_bound_runtime_for_ollama_startup(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api import config as api_config
    from lightrag.api import lightrag_server

    monkeypatch.setattr(lightrag_server, "LightRAG", _DummyRAG)
    monkeypatch.setattr(
      lightrag_server, "create_document_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(
      lightrag_server, "create_query_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(lightrag_server, "check_frontend_build", lambda: (False, False))
    monkeypatch.setattr(
      lightrag_server, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )
    monkeypatch.setattr(
      lightrag_server, "global_args", SimpleNamespace(cors_origins="*")
    )
    monkeypatch.setattr(lightrag_server, "cleanup_keyed_lock", lambda: {})
    monkeypatch.setattr(lightrag_server, "get_default_workspace", lambda: "")

    fake_ollama_module = types.ModuleType("lightrag.llm.ollama")

    async def _fake_ollama_model_complete(*args, **kwargs):
      return "ok"

    async def _fake_ollama_embed(*args, **kwargs):
      return []

    fake_ollama_module.ollama_model_complete = _fake_ollama_model_complete
    fake_ollama_module.ollama_embed = _fake_ollama_embed
    monkeypatch.setitem(sys.modules, "lightrag.llm.ollama", fake_ollama_module)

    async def _fake_get_namespace_data(*args, **kwargs):
      return {"busy": False}

    monkeypatch.setattr(lightrag_server, "get_namespace_data", _fake_get_namespace_data)

    args = api_config.parse_args()
    args.working_dir = str(tmp_path / "rag_storage")
    args.input_dir = str(tmp_path / "inputs")
    args.workspace = ""
    args.workspace_registry_path = str(tmp_path / "workspaces" / "registry.sqlite3")

    app = lightrag_server.create_app(args)

    with TestClient(app) as client:
      response = client.get("/api/version")

    assert response.status_code == 200
