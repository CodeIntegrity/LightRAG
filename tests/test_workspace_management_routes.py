from pathlib import Path
import asyncio
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


pytestmark = pytest.mark.offline


class _DeleteScheduler:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, workspace: str, requested_by: str) -> None:
        self.calls.append((workspace, requested_by))


def _build_token(username: str, role: str) -> str:
    from lightrag.api.auth import auth_handler

    return auth_handler.create_token(username, role=role)


@pytest.fixture
def workspace_app(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(sys, "argv", [sys.argv[0]])
    import lightrag.api.routers.workspace_routes as workspace_routes
    from lightrag.api.workspace_registry import WorkspaceRegistryStore

    store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
    scheduler = _DeleteScheduler()

    async def _init() -> None:
        await store.initialize(default_workspace="")
        await store.create_workspace(
            workspace="private_ws",
            display_name="Private",
            description="private",
            created_by="alice",
            visibility="private",
        )
        await store.create_workspace(
            workspace="public_ws",
            display_name="Public",
            description="public",
            created_by="alice",
            visibility="public",
        )

    import asyncio

    asyncio.run(_init())

    monkeypatch.setattr(
        workspace_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
    )

    app = FastAPI()
    app.include_router(
        workspace_routes.create_workspace_routes(
            registry_store=store,
            delete_scheduler=scheduler,
            stats_provider=lambda workspace: {
                "document_count": 2,
                "entity_count": None,
                "relation_count": None,
                "chunk_count": None,
                "storage_size_bytes": None,
                "prompt_version_count": 4,
                "capabilities": {
                    "document_count": "available",
                    "entity_count": "unsupported_by_backend",
                    "relation_count": "unsupported_by_backend",
                    "chunk_count": "unsupported_by_backend",
                    "storage_size_bytes": "unsupported_by_backend",
                    "prompt_version_count": "available",
                },
            },
            api_key=None,
        )
    )

    return TestClient(app), store, scheduler


def test_list_workspaces_hides_private_entries_from_guest(workspace_app):
    client, _, _ = workspace_app

    response = client.get("/workspaces")

    assert response.status_code == 200
    names = [item["workspace"] for item in response.json()["workspaces"]]
    assert "" in names
    assert "public_ws" in names
    assert "private_ws" not in names


def test_create_workspace_as_user_sets_creator_and_owner(workspace_app):
    client, store, _ = workspace_app

    response = client.post(
        "/workspaces",
        json={
            "workspace": "books",
            "display_name": "Books",
            "description": "Long-form corpus",
            "visibility": "private",
        },
        headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
    )

    assert response.status_code == 201
    created = response.json()
    assert created["workspace"] == "books"
    assert created["created_by"] == "alice"
    assert created["owners"] == ["alice"]

    stored = asyncio.run(store.get_workspace("books"))
    assert stored["visibility"] == "private"


def test_hard_delete_requires_admin_and_returns_accepted(workspace_app):
    client, store, scheduler = workspace_app

    response = client.post(
        "/workspaces/public_ws/hard-delete",
        headers={"Authorization": f"Bearer {_build_token('admin', 'admin')}"},
    )

    assert response.status_code == 202
    body = response.json()
    assert body["workspace"] == "public_ws"
    assert body["status"] == "hard_deleting"
    assert scheduler.calls == [("public_ws", "admin")]


def test_workspace_stats_include_capabilities(workspace_app):
    client, _, _ = workspace_app

    response = client.get("/workspaces/public_ws/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["document_count"] == 2
    assert body["prompt_version_count"] == 4
    assert body["capabilities"]["document_count"] == "available"
    assert body["capabilities"]["storage_size_bytes"] == "unsupported_by_backend"
