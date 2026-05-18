import sys
import types
from types import SimpleNamespace

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from lightrag.prompt_version_store import PromptVersionStore


pytestmark = pytest.mark.offline


class _DummyDropStorage:
    async def drop(self):
        return None


class _DummyGraphStorage:
    def __init__(self, workspace: str):
        self.workspace = workspace

    async def drop(self):
        return None

    async def get_popular_labels(self, limit: int):
        return [f"{self.workspace}:popular:{limit}"]


class _DummyRAG:
    instances: list["_DummyRAG"] = []
    finalized_instance_ids: list[int] = []

    def __init__(self, *args, **kwargs):
        self.ollama_server_infos = kwargs.get("ollama_server_infos")
        self.working_dir = kwargs["working_dir"]
        self.workspace = kwargs.get("workspace", "")
        self.prompt_version_store = PromptVersionStore(
            kwargs["working_dir"], workspace=self.workspace
        )
        self.chunk_entity_relation_graph = _DummyGraphStorage(self.workspace or "default")
        self.text_chunks = _DummyDropStorage()
        self.full_docs = _DummyDropStorage()
        self.full_entities = _DummyDropStorage()
        self.full_relations = _DummyDropStorage()
        self.entity_chunks = _DummyDropStorage()
        self.relation_chunks = _DummyDropStorage()
        self.entities_vdb = _DummyDropStorage()
        self.relationships_vdb = _DummyDropStorage()
        self.chunks_vdb = _DummyDropStorage()
        self.doc_status = _DummyDropStorage()
        type(self).instances.append(self)

    async def initialize_storages(self):
        return None

    async def check_and_migrate_data(self):
        return None

    async def finalize_storages(self):
        type(self).finalized_instance_ids.append(id(self))
        return None

    async def get_graph_labels(self):
        return [self.workspace or "default"]

    async def aquery_llm(self, query: str, param=None):
        return {
            "llm_response": {"content": f"{self.workspace or 'default'}:{query}"},
            "data": {"references": []},
        }


class _FailingStartupRAG(_DummyRAG):
    async def initialize_storages(self):
        raise ImportError("nebula3-python is required for NebulaGraphStorage")


class _DummyOllamaAPI:
    def __init__(self, rag, top_k=60, api_key=None):
        self.router = APIRouter()


def _build_token(username: str, role: str) -> str:
    from lightrag.api.auth import auth_handler

    return auth_handler.create_token(username, role=role)


@pytest.fixture
def graph_test_client(monkeypatch, tmp_path):
    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=False,
        include_graph_routes=True,
    )
    with TestClient(app) as client:
        yield client


@pytest.fixture
def query_test_client(monkeypatch, tmp_path):
    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=True,
        include_graph_routes=False,
    )
    with TestClient(app) as client:
        yield client


def _build_runtime_test_app(
    monkeypatch,
    tmp_path,
    *,
    include_query_routes: bool,
    include_graph_routes: bool,
    default_workspace: str = "",
    capture: dict[str, object] | None = None,
):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api import config as api_config
    from lightrag.api import lightrag_server

    monkeypatch.setattr(lightrag_server, "LightRAG", _DummyRAG)
    monkeypatch.setattr(lightrag_server, "OllamaAPI", _DummyOllamaAPI)
    monkeypatch.setattr(
        lightrag_server, "create_document_routes", lambda *args, **kwargs: APIRouter()
    )
    if not include_query_routes:
        monkeypatch.setattr(
            lightrag_server, "create_query_routes", lambda *args, **kwargs: APIRouter()
        )
    if not include_graph_routes:
        monkeypatch.setattr(
            lightrag_server, "create_graph_routes", lambda *args, **kwargs: APIRouter()
        )
    monkeypatch.setattr(lightrag_server, "check_frontend_build", lambda: (False, False))
    monkeypatch.setattr(
        lightrag_server, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )
    import lightrag.api.routers.workspace_routes as workspace_routes

    monkeypatch.setattr(
        workspace_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )
    if capture is not None:
        real_create_workspace_routes = workspace_routes.create_workspace_routes

        def _capture_create_workspace_routes(*args, **kwargs):
            capture["delete_scheduler"] = kwargs.get("delete_scheduler")
            return real_create_workspace_routes(*args, **kwargs)

        monkeypatch.setattr(
            lightrag_server, "create_workspace_routes", _capture_create_workspace_routes
        )
    monkeypatch.setattr(
        lightrag_server, "global_args", SimpleNamespace(cors_origins="*")
    )
    monkeypatch.setattr(lightrag_server, "cleanup_keyed_lock", lambda: {})
    monkeypatch.setattr(
        lightrag_server, "get_default_workspace", lambda: default_workspace
    )
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
    args.workspace = default_workspace
    args.workspace_registry_path = str(tmp_path / "workspaces" / "registry.sqlite3")
    return lightrag_server.create_app(args)


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
        "/graph/label/list",
        headers={
            "Authorization": f"Bearer {_build_token('alice', 'user')}",
            "LIGHTRAG-WORKSPACE": "ws1",
        },
    )

    assert response.status_code == 200
    assert response.json() == ["ws1"]


def test_query_routes_resolve_runtime_from_workspace_header(query_test_client):
    create_response = query_test_client.post(
        "/workspaces",
        json={
            "workspace": "ws1",
            "display_name": "Workspace 1",
            "description": "query test",
            "visibility": "public",
        },
        headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
    )

    assert create_response.status_code == 201

    response = query_test_client.post(
        "/query",
        json={"query": "workspace aware"},
        headers={
            "Authorization": f"Bearer {_build_token('alice', 'user')}",
            "LIGHTRAG-WORKSPACE": "ws1",
        },
    )

    assert response.status_code == 200
    assert response.json()["response"] == "ws1:workspace aware"


def test_runtime_binding_returns_404_for_unregistered_workspace(
    monkeypatch, tmp_path
):
    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=False,
        include_graph_routes=True,
    )

    with TestClient(app) as client:
        response = client.get(
            "/graph/label/list",
            headers={
                "Authorization": f"Bearer {_build_token('alice', 'user')}",
                "LIGHTRAG-WORKSPACE": "missing_ws",
            },
        )

    assert response.status_code == 404
    assert response.json() == {"detail": "Workspace 'missing_ws' is not registered"}


def test_runtime_binding_returns_500_for_registry_internal_error(
    monkeypatch, tmp_path
):
    from lightrag.api import lightrag_server

    async def _boom(self, workspace: str):
        raise RuntimeError(f"sqlite blew up for {workspace}")

    monkeypatch.setattr(lightrag_server.WorkspaceRegistryStore, "get_workspace", _boom)

    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=False,
        include_graph_routes=True,
    )

    with TestClient(app) as client:
        response = client.get(
            "/graph/label/list",
            headers={
                "Authorization": f"Bearer {_build_token('alice', 'user')}",
                "LIGHTRAG-WORKSPACE": "ws1",
            },
        )

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Failed to resolve workspace 'ws1' runtime binding"
    }


def test_runtime_binding_rejects_invalid_workspace_header(
    monkeypatch, tmp_path
):
    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=True,
        include_graph_routes=False,
    )

    with TestClient(app) as client:
        response = client.post(
            "/query",
            json={"query": "workspace aware"},
            headers={
                "Authorization": f"Bearer {_build_token('alice', 'user')}",
                "LIGHTRAG-WORKSPACE": "bad-workspace",
            },
        )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Workspace identifier may only contain letters, numbers, and underscores."
    }


def test_query_routes_fall_back_to_default_workspace_without_header(
    monkeypatch, tmp_path
):
    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=True,
        include_graph_routes=False,
        default_workspace="default_ws",
    )

    with TestClient(app) as client:
        response = client.post(
            "/query",
            json={"query": "workspace aware"},
            headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
        )

    assert response.status_code == 200
    assert response.json()["response"] == "default_ws:workspace aware"


def test_cached_runtime_allows_query_when_registry_temporarily_fails(
    monkeypatch, tmp_path
):
    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=True,
        include_graph_routes=False,
    )
    from lightrag.api import lightrag_server

    with TestClient(app) as client:
        create_response = client.post(
            "/workspaces",
            json={
                "workspace": "ws1",
                "display_name": "Workspace 1",
                "description": "cache test",
                "visibility": "public",
            },
            headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
        )
        assert create_response.status_code == 201

        first_response = client.post(
            "/query",
            json={"query": "warm cache"},
            headers={
                "Authorization": f"Bearer {_build_token('alice', 'user')}",
                "LIGHTRAG-WORKSPACE": "ws1",
            },
        )
        assert first_response.status_code == 200
        assert first_response.json()["response"] == "ws1:warm cache"

        async def _boom(self, workspace: str):
            raise RuntimeError(f"sqlite blew up for {workspace}")

        monkeypatch.setattr(
            lightrag_server.WorkspaceRegistryStore, "get_workspace", _boom
        )

        second_response = client.post(
            "/query",
            json={"query": "cache hit"},
            headers={
                "Authorization": f"Bearer {_build_token('alice', 'user')}",
                "LIGHTRAG-WORKSPACE": "ws1",
            },
        )

    assert second_response.status_code == 200
    assert second_response.json()["response"] == "ws1:cache hit"


def test_delete_workspace_data_uses_isolated_runtime_for_default_workspace(
    monkeypatch, tmp_path
):
    _DummyRAG.instances.clear()
    _DummyRAG.finalized_instance_ids.clear()
    captured: dict[str, object] = {}

    app = _build_runtime_test_app(
        monkeypatch,
        tmp_path,
        include_query_routes=False,
        include_graph_routes=False,
        default_workspace="default_ws",
        capture=captured,
    )

    with TestClient(app):
        scheduler = captured["delete_scheduler"]
        assert scheduler is not None
        import asyncio

        asyncio.run(scheduler("default_ws", "admin"))  # type: ignore[misc]

        default_instances = [
            instance
            for instance in _DummyRAG.instances
            if instance.workspace == "default_ws"
        ]
        assert len(default_instances) >= 2

        main_instance = default_instances[0]
        finalized_ids = set(_DummyRAG.finalized_instance_ids)
        assert id(main_instance) not in finalized_ids
        assert any(id(instance) in finalized_ids for instance in default_instances[1:])


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


def test_create_app_preserves_startup_error_without_prune_task_unbound(
    monkeypatch, tmp_path
):
    _DummyRAG.instances.clear()
    _DummyRAG.finalized_instance_ids.clear()
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])

    from lightrag.api import config as api_config
    from lightrag.api import lightrag_server

    monkeypatch.setattr(lightrag_server, "LightRAG", _FailingStartupRAG)
    monkeypatch.setattr(lightrag_server, "OllamaAPI", _DummyOllamaAPI)
    monkeypatch.setattr(
        lightrag_server, "create_document_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(
        lightrag_server, "create_query_routes", lambda *args, **kwargs: APIRouter()
    )
    monkeypatch.setattr(
        lightrag_server, "create_graph_routes", lambda *args, **kwargs: APIRouter()
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

    with pytest.raises(ImportError, match="nebula3-python is required"):
        with TestClient(app):
            pass

    assert len(_DummyRAG.instances) == 1
    assert _DummyRAG.finalized_instance_ids == [id(_DummyRAG.instances[0])]
