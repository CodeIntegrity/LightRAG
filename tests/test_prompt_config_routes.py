import sys
import types
from types import SimpleNamespace

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from lightrag.base import DocStatus
from lightrag.prompt_version_store import PromptVersionStore

pytestmark = pytest.mark.offline


class _DummyDocStatus:
    def __init__(self, workspace: str):
        self.workspace = workspace

    async def get_all_status_counts(self) -> dict[str, int]:
        if self.workspace == "ws1":
            return {"all": 2}
        return {"all": 0}

    async def get_docs_by_status(self, status: DocStatus) -> dict[str, object]:
        if self.workspace != "ws1":
            return {}
        if status == DocStatus.PROCESSED:
            return {
                "doc-1": SimpleNamespace(chunks_count=3),
                "doc-2": SimpleNamespace(chunks_count=2),
            }
        return {}


class _DummyRAG:
    def __init__(self, *args, **kwargs):
        self.ollama_server_infos = kwargs.get("ollama_server_infos")
        self.working_dir = kwargs["working_dir"]
        self.workspace = kwargs.get("workspace", "")
        self.doc_status = _DummyDocStatus(self.workspace or "default")
        self.prompt_version_store = PromptVersionStore(
            kwargs["working_dir"], workspace=kwargs.get("workspace", "")
        )

    async def initialize_storages(self):
        return None

    async def check_and_migrate_data(self):
        return None

    async def finalize_storages(self):
        return None


class _DummyOllamaAPI:
    def __init__(self, rag, top_k=60, api_key=None):
        self.router = APIRouter()


def _build_token(username: str, role: str) -> str:
    from lightrag.api.auth import auth_handler

    return auth_handler.create_token(username, role=role)


def _build_test_client(
    monkeypatch,
    tmp_path,
    *,
    allow_guest_workspace_create: bool = False,
    enable_guest_login_entry: bool = False,
    guest_visible_tabs: list[str] | None = None,
    summary_language: str | None = None,
):
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
    monkeypatch.setattr(lightrag_server, "get_default_workspace", lambda: "default")
    monkeypatch.setattr(lightrag_server, "cleanup_keyed_lock", lambda: {})
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
    args.working_dir = str(tmp_path)
    args.input_dir = str(tmp_path / "inputs")
    args.workspace_registry_path = str(tmp_path / "workspaces" / "registry.sqlite3")
    args.allow_guest_workspace_create = allow_guest_workspace_create
    args.enable_guest_login_entry = enable_guest_login_entry
    args.guest_visible_tabs = guest_visible_tabs or [
        "documents",
        "knowledge-graph",
        "prompt-management",
        "retrieval",
        "api",
    ]
    if summary_language is not None:
        args.summary_language = summary_language
    app = lightrag_server.create_app(args)
    return TestClient(app)


@pytest.fixture
def test_client(monkeypatch, tmp_path):
    with _build_test_client(monkeypatch, tmp_path) as client:
        yield client


def test_initialize_prompt_config_creates_seed_versions(test_client):
    response = test_client.post("/prompt-config/initialize")

    assert response.status_code == 200
    body = response.json()
    assert body["indexing"]["versions"]
    assert body["retrieval"]["versions"]


def test_activate_indexing_version_returns_warning_metadata(test_client):
    seeded = test_client.post("/prompt-config/initialize").json()
    version_id = seeded["indexing"]["versions"][0]["version_id"]

    response = test_client.post(f"/prompt-config/indexing/versions/{version_id}/activate")

    assert response.status_code == 200
    assert "warning" in response.json()


def test_delete_active_version_is_rejected(test_client):
    seeded = test_client.post("/prompt-config/initialize").json()
    active_id = seeded["retrieval"]["versions"][0]["version_id"]
    test_client.post(f"/prompt-config/retrieval/versions/{active_id}/activate")

    response = test_client.delete(f"/prompt-config/retrieval/versions/{active_id}")

    assert response.status_code == 400


def test_update_prompt_version_updates_selected_record(test_client):
    seeded = test_client.post("/prompt-config/initialize").json()
    version_id = seeded["retrieval"]["versions"][0]["version_id"]

    response = test_client.patch(
        f"/prompt-config/retrieval/versions/{version_id}",
        json={
            "version_name": "retrieval-inline",
            "comment": "edited",
            "payload": {
                "query": {"rag_response": "INLINE {context_data}"},
                "keywords": {"keywords_extraction": "INLINE {query} {examples}"},
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["version_id"] == version_id
    assert body["version_name"] == "retrieval-inline"
    assert body["comment"] == "edited"
    assert body["payload"]["query"]["rag_response"] == "INLINE {context_data}"


def test_health_exposes_active_prompt_version_summary(test_client):
    seeded = test_client.post("/prompt-config/initialize").json()
    active_id = seeded["retrieval"]["versions"][0]["version_id"]
    active_name = seeded["retrieval"]["versions"][0]["version_name"]
    test_client.post(f"/prompt-config/retrieval/versions/{active_id}/activate")

    response = test_client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["configuration"]["active_prompt_versions"]["retrieval"] == {
        "active_version_id": active_id,
        "active_version_name": active_name,
    }


def test_health_reports_request_workspace_instead_of_default(test_client):
    response = test_client.get("/health", headers={"LIGHTRAG-WORKSPACE": "alt_ws"})

    assert response.status_code == 200
    assert response.json()["configuration"]["workspace"] == "alt_ws"


def test_prompt_config_routes_are_scoped_by_workspace_header(test_client):
    seeded_ws1 = test_client.post(
        "/prompt-config/initialize", headers={"LIGHTRAG-WORKSPACE": "ws1"}
    )
    ws1_groups = test_client.get(
        "/prompt-config/groups", headers={"LIGHTRAG-WORKSPACE": "ws1"}
    )
    ws2_groups = test_client.get(
        "/prompt-config/groups", headers={"LIGHTRAG-WORKSPACE": "ws2"}
    )

    assert seeded_ws1.status_code == 200
    assert ws1_groups.status_code == 200
    assert ws2_groups.status_code == 200
    assert ws1_groups.json()["retrieval"]["versions"]
    assert ws2_groups.json()["retrieval"]["versions"] == []


def test_workspace_routes_are_mounted_on_application(test_client):
    response = test_client.get("/workspaces")

    assert response.status_code == 200
    assert "workspaces" in response.json()


def test_workspace_stats_route_is_mounted_on_application(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=True
    ) as client:
        create_response = client.post(
            "/workspaces",
            json={
                "workspace": "stats_ws",
                "display_name": "Stats Workspace",
                "description": "stats",
                "visibility": "public",
            },
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )
        assert create_response.status_code == 201

        response = client.get("/workspaces/stats_ws/stats")

        assert response.status_code == 200
        body = response.json()
        assert "document_count" in body
        assert "prompt_version_count" in body
        assert "capabilities" in body
        assert body["capabilities"]["document_count"] == "not_loaded"


def test_workspace_stats_expose_chunk_count_capability(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=True
    ) as client:
        create_response = client.post(
            "/workspaces",
            json={
                "workspace": "ws1",
                "display_name": "Workspace 1",
                "description": "stats test",
                "visibility": "public",
            },
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )
        assert create_response.status_code == 201

        response = client.get("/workspaces/ws1/stats?include_runtime=true")

        assert response.status_code == 200
        body = response.json()
        assert body["document_count"] == 2
        assert body["chunk_count"] == 5
        assert body["capabilities"]["document_count"] == "available"
        assert body["capabilities"]["chunk_count"] == "available"
        assert body["entity_count"] is None
        assert body["relation_count"] is None
        assert body["storage_size_bytes"] is None


def test_workspace_creation_initializes_english_prompt_seed(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch,
        tmp_path,
        summary_language="English",
        allow_guest_workspace_create=True,
    ) as client:
        create_response = client.post(
            "/workspaces",
            json={
                "workspace": "english_ws",
                "display_name": "English Workspace",
                "description": "english seed",
                "visibility": "public",
            },
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )

    assert create_response.status_code == 201
    store = PromptVersionStore(str(tmp_path), workspace="english_ws")
    groups = store.list_versions("indexing")
    assert groups["versions"][0]["comment"] == "English initial version"


def test_workspace_creation_initializes_chinese_prompt_seed(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch,
        tmp_path,
        summary_language="Chinese",
        allow_guest_workspace_create=True,
    ) as client:
        create_response = client.post(
            "/workspaces",
            json={
                "workspace": "chinese_ws",
                "display_name": "Chinese Workspace",
                "description": "chinese seed",
                "visibility": "public",
            },
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )

    assert create_response.status_code == 201
    store = PromptVersionStore(str(tmp_path), workspace="chinese_ws")
    groups = store.list_versions("indexing")
    assert groups["versions"][0]["comment"] == "中文初始版本"


def test_health_exposes_workspace_create_capability_for_guest_when_enabled(
    monkeypatch, tmp_path
):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=True
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )

    assert response.status_code == 200
    assert response.json()["capabilities"]["workspace_create"] is True


def test_health_exposes_guest_login_capability_when_enabled(monkeypatch, tmp_path):
    from lightrag.api.auth import auth_handler

    original_accounts = auth_handler.accounts.copy()
    auth_handler.accounts = {"alice": "secret"}
    try:
        with _build_test_client(
            monkeypatch,
            tmp_path,
            allow_guest_workspace_create=False,
            enable_guest_login_entry=True,
        ) as client:
            response = client.get("/health")

        assert response.status_code == 200
        assert response.json()["capabilities"]["guest_login"] is True
    finally:
        auth_handler.accounts = original_accounts


def test_health_exposes_guest_login_capability_when_disabled(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch,
        tmp_path,
        allow_guest_workspace_create=False,
        enable_guest_login_entry=False,
    ) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["capabilities"]["guest_login"] is False


def test_health_exposes_guest_visible_tabs_from_env(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch,
        tmp_path,
        guest_visible_tabs=["documents", "retrieval"],
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )

    assert response.status_code == 200
    assert response.json()["capabilities"]["guest_visible_tabs"] == [
        "documents",
        "retrieval",
    ]


def test_auth_status_exposes_guest_visible_tabs_from_env(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch,
        tmp_path,
        guest_visible_tabs=["documents", "api"],
    ) as client:
        response = client.get("/auth-status")

    assert response.status_code == 200
    assert response.json()["guest_visible_tabs"] == ["documents", "api"]


def test_health_exposes_workspace_create_capability_for_guest_when_disabled(
    monkeypatch, tmp_path
):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=False
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
        )

    assert response.status_code == 200
    assert response.json()["capabilities"]["workspace_create"] is False


def test_health_exposes_workspace_create_capability_for_logged_in_user(
    monkeypatch, tmp_path
):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=False
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
        )

    assert response.status_code == 200
    assert response.json()["capabilities"]["workspace_create"] is True


def test_health_exposes_workspace_create_capability_as_false_without_authorization(
    monkeypatch, tmp_path
):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=True
    ) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["capabilities"]["workspace_create"] is False


def test_health_rejects_invalid_authorization_header(monkeypatch, tmp_path):
    with _build_test_client(
        monkeypatch, tmp_path, allow_guest_workspace_create=True
    ) as client:
        response = client.get(
            "/health",
            headers={"Authorization": "Basic abc"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid authorization header"


def test_health_reports_workspace_create_false_for_guest_token_when_auth_is_configured(
    monkeypatch, tmp_path
):
    from lightrag.api.auth import auth_handler

    original_accounts = auth_handler.accounts.copy()
    auth_handler.accounts = {"alice": "secret"}
    try:
        with _build_test_client(
            monkeypatch, tmp_path, allow_guest_workspace_create=True
        ) as client:
            response = client.get(
                "/health",
                headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
            )

        assert response.status_code == 200
        assert response.json()["capabilities"]["workspace_create"] is False
    finally:
        auth_handler.accounts = original_accounts


def test_login_guest_returns_guest_token_when_entry_enabled(monkeypatch, tmp_path):
    from lightrag.api.auth import auth_handler

    original_accounts = auth_handler.accounts.copy()
    auth_handler.accounts = {"alice": "secret"}
    try:
        with _build_test_client(
            monkeypatch, tmp_path, enable_guest_login_entry=True
        ) as client:
            response = client.post("/login/guest")

        assert response.status_code == 200
        body = response.json()
        assert body["auth_mode"] == "guest"
        payload = auth_handler.validate_token(body["access_token"])
        assert payload["role"] == "guest"
        assert payload["username"] == "guest"
    finally:
        auth_handler.accounts = original_accounts


def test_login_guest_rejects_when_entry_disabled(monkeypatch, tmp_path):
    from lightrag.api.auth import auth_handler

    original_accounts = auth_handler.accounts.copy()
    auth_handler.accounts = {"alice": "secret"}
    try:
        with _build_test_client(
            monkeypatch, tmp_path, enable_guest_login_entry=False
        ) as client:
            response = client.post("/login/guest")

        assert response.status_code == 403
        assert response.json()["detail"] == "Guest login is disabled"
    finally:
        auth_handler.accounts = original_accounts
