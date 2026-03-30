import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.argv = sys.argv[:1]

from lightrag.api import workspace_runtime  # noqa: E402
from lightrag.api.routers import document_routes  # noqa: E402
from lightrag.api.routers.document_routes import DocumentManager  # noqa: E402
from lightrag.kg import shared_storage  # noqa: E402


pytestmark = pytest.mark.offline


class _DummyLock:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _DummyDocStatus:
    def __init__(self):
        self.file_path_queries: list[str] = []

    async def get_doc_by_file_path(self, file_path: str):
        self.file_path_queries.append(file_path)
        return None


class _DummyRAG:
    def __init__(self, workspace: str):
        self.workspace = workspace
        self.doc_status = _DummyDocStatus()


def _build_runtime_document_client(tmp_path: Path, monkeypatch, workspace: str):
    bundle = workspace_runtime.WorkspaceRuntimeBundle(
        workspace=workspace,
        rag=_DummyRAG(workspace),
        doc_manager=DocumentManager(str(tmp_path / "inputs"), workspace=workspace),
    )
    rag_proxy = workspace_runtime.WorkspaceRuntimeProxy(lambda current: current.rag)
    doc_manager_proxy = workspace_runtime.WorkspaceRuntimeProxy(
        lambda current: current.doc_manager
    )
    scheduled_tasks: list[tuple[object, Path, str]] = []

    monkeypatch.setattr(
        document_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )
    monkeypatch.setattr(
        document_routes, "generate_track_id", lambda prefix: f"{prefix}-123"
    )

    async def _fake_pipeline_index_file(rag, file_path: Path, track_id: str):
        scheduled_tasks.append((rag, file_path, track_id))

    monkeypatch.setattr(
        document_routes, "pipeline_index_file", _fake_pipeline_index_file
    )

    app = FastAPI()

    @app.middleware("http")
    async def _bind_runtime(request, call_next):
        tokens = workspace_runtime.bind_current_runtime(bundle)
        try:
            return await call_next(request)
        finally:
            workspace_runtime.reset_current_runtime(tokens)

    app.include_router(document_routes.create_document_routes(rag_proxy, doc_manager_proxy))

    client = TestClient(app)
    return client, bundle, scheduled_tasks


def test_upload_route_resolves_workspace_runtime_input_dir(tmp_path: Path, monkeypatch):
    client, bundle, scheduled_tasks = _build_runtime_document_client(
        tmp_path, monkeypatch, workspace="ws-upload"
    )

    response = client.post(
        "/documents/upload",
        files={"file": ("JZ9-XXX 井作业回顾.md", b"# content\n", "text/markdown")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["track_id"] == "upload-123"

    expected_path = bundle.doc_manager.input_dir / "JZ9-XXX 井作业回顾.md"
    assert expected_path.exists()
    assert bundle.rag.doc_status.file_path_queries == ["JZ9-XXX 井作业回顾.md"]
    assert scheduled_tasks == [(bundle.rag, expected_path, "upload-123")]


def test_pipeline_status_route_uses_current_workspace(tmp_path: Path, monkeypatch):
    client, _, _ = _build_runtime_document_client(
        tmp_path, monkeypatch, workspace="ws-status"
    )
    observed_workspaces: dict[str, object] = {}
    pipeline_status = {
        "autoscanned": False,
        "busy": False,
        "job_name": "Idle",
        "job_start": None,
        "docs": 0,
        "batchs": 0,
        "cur_batch": 0,
        "request_pending": False,
        "latest_message": "",
        "history_messages": [],
    }

    async def _fake_get_namespace_data(namespace: str, workspace=None):
        observed_workspaces["data"] = workspace
        return pipeline_status

    def _fake_get_namespace_lock(namespace: str, workspace=None):
        observed_workspaces["lock"] = workspace
        return _DummyLock()

    async def _fake_get_all_update_flags_status(workspace=None):
        observed_workspaces["update"] = workspace
        return {"pipeline_status": [True]}

    monkeypatch.setattr(shared_storage, "get_namespace_data", _fake_get_namespace_data)
    monkeypatch.setattr(shared_storage, "get_namespace_lock", _fake_get_namespace_lock)
    monkeypatch.setattr(
        shared_storage,
        "get_all_update_flags_status",
        _fake_get_all_update_flags_status,
    )

    response = client.get("/documents/pipeline_status")

    assert response.status_code == 200
    assert observed_workspaces == {
        "data": "ws-status",
        "lock": "ws-status",
        "update": "ws-status",
    }
    assert response.json()["update_status"] == {"pipeline_status": [True]}
