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
def workspace_app_factory(monkeypatch, tmp_path: Path):
    def _build(
        *,
        allow_guest_create: bool = False,
        default_workspace: str = "",
        workspace_initializer=None,
    ):
        monkeypatch.setattr(sys, "argv", [sys.argv[0]])
        import lightrag.api.routers.workspace_routes as workspace_routes
        from lightrag.api.workspace_registry import WorkspaceRegistryStore

        store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
        scheduler = _DeleteScheduler()

        async def _init() -> None:
            await store.initialize(default_workspace=default_workspace)
            await store.create_workspace(
                workspace="private_ws",
                display_name="Private",
                description="private",
                created_by="alice",
                visibility="private",
            )
            await store.complete_workspace_creation("private_ws")
            await store.create_workspace(
                workspace="public_ws",
                display_name="Public",
                description="public",
                created_by="alice",
                visibility="public",
            )
            await store.complete_workspace_creation("public_ws")

        asyncio.run(_init())
        monkeypatch.setattr(
            workspace_routes, "get_combined_auth_dependency", lambda *_: (lambda: None)
        )

        app = FastAPI()
        app.include_router(
            workspace_routes.create_workspace_routes(
                registry_store=store,
                delete_scheduler=scheduler,
                workspace_initializer=workspace_initializer,
                stats_provider=lambda workspace, include_runtime=False: {
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
                allow_guest_create=allow_guest_create,
            )
        )
        return TestClient(app), store, scheduler

    return _build


@pytest.fixture
def workspace_app(workspace_app_factory):
    return workspace_app_factory()


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
    assert stored["status"] == "ready"


def test_create_workspace_as_guest_returns_403_when_disabled(workspace_app_factory):
    client, _, _ = workspace_app_factory(allow_guest_create=False)

    response = client.post(
        "/workspaces",
        json={
            "workspace": "guest_books",
            "display_name": "Guest Books",
            "description": "guest workspace",
            "visibility": "private",
        },
        headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Workspace creation is not allowed for this session"


def test_create_workspace_as_guest_sets_creator_and_owner_when_enabled(
    workspace_app_factory, monkeypatch
):
    from lightrag.api.auth import auth_handler

    monkeypatch.setattr(auth_handler, "accounts", {})
    client, store, _ = workspace_app_factory(allow_guest_create=True)

    response = client.post(
        "/workspaces",
        json={
            "workspace": "guest_books",
            "display_name": "Guest Books",
            "description": "guest workspace",
            "visibility": "private",
        },
        headers={"Authorization": f"Bearer {_build_token('guest', 'guest')}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created_by"] == "guest"
    assert body["owners"] == ["guest"]

    stored = asyncio.run(store.get_workspace("guest_books"))
    assert stored["created_by"] == "guest"
    assert stored["owners"] == ["guest"]


def test_create_workspace_rejects_non_ascii_identifier(workspace_app):
    client, _, _ = workspace_app

    response = client.post(
        "/workspaces",
        json={
            "workspace": "作业回顾",
            "display_name": "作业回顾",
            "description": "guest workspace",
            "visibility": "private",
        },
        headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
    )

    assert response.status_code == 422
    assert "letters, numbers, and underscores" in response.text


def test_create_workspace_without_authorization_header_returns_403_even_when_guest_create_enabled(
    workspace_app_factory,
):
    client, _, _ = workspace_app_factory(allow_guest_create=True)

    response = client.post(
        "/workspaces",
        json={
            "workspace": "guest_books",
            "display_name": "Guest Books",
            "description": "guest workspace",
            "visibility": "private",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Workspace creation is not allowed for this session"


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


def test_hard_delete_rejects_current_active_workspace(workspace_app):
    client, store, scheduler = workspace_app

    response = client.post(
        "/workspaces/public_ws/hard-delete",
        headers={
            "Authorization": f"Bearer {_build_token('admin', 'admin')}",
            "LIGHTRAG-WORKSPACE": "public_ws",
        },
    )

    assert response.status_code == 400
    assert "switch to another workspace" in response.json()["detail"].lower()
    assert scheduler.calls == []

    stored = asyncio.run(store.get_workspace("public_ws"))
    assert stored["status"] == "ready"


def test_hard_delete_rejects_default_workspace(workspace_app_factory):
    client, store, scheduler = workspace_app_factory(default_workspace="default_ws")

    response = client.post(
        "/workspaces/default_ws/hard-delete",
        headers={"Authorization": f"Bearer {_build_token('admin', 'admin')}"},
    )

    assert response.status_code == 400
    assert "default workspace" in response.json()["detail"].lower()
    assert scheduler.calls == []

    stored = asyncio.run(store.get_workspace("default_ws"))
    assert stored["status"] == "ready"
    assert stored["is_default"] is True


def test_soft_delete_rejects_current_active_workspace(workspace_app):
    client, store, _ = workspace_app

    response = client.post(
        "/workspaces/public_ws/soft-delete",
        headers={
            "Authorization": f"Bearer {_build_token('alice', 'user')}",
            "LIGHTRAG-WORKSPACE": "public_ws",
        },
    )

    assert response.status_code == 400
    assert "switch to another workspace" in response.json()["detail"].lower()

    stored = asyncio.run(store.get_workspace("public_ws"))
    assert stored["status"] == "ready"


def test_workspace_stats_include_capabilities(workspace_app):
    client, _, _ = workspace_app

    response = client.get("/workspaces/public_ws/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["document_count"] == 2
    assert body["prompt_version_count"] == 4
    assert body["capabilities"]["document_count"] == "available"
    assert body["capabilities"]["storage_size_bytes"] == "unsupported_by_backend"


def test_create_workspace_failure_marks_workspace_as_create_failed(workspace_app_factory):
    async def _failing_initializer(_: str) -> None:
        raise RuntimeError("seed init failed")

    client, store, _ = workspace_app_factory(workspace_initializer=_failing_initializer)

    response = client.post(
        "/workspaces",
        json={
            "workspace": "broken_ws",
            "display_name": "Broken",
            "description": "broken workspace",
            "visibility": "private",
        },
        headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
    )

    assert response.status_code == 500
    assert "Workspace initialization failed" in response.json()["detail"]

    stored = asyncio.run(store.get_workspace("broken_ws"))
    assert stored["status"] == "create_failed"
    assert stored["delete_error"] == "seed init failed"

    operation = asyncio.run(store.get_workspace_operation("broken_ws"))
    assert operation["kind"] == "create"
    assert operation["state"] == "failed"
    assert operation["error"] == "seed init failed"

    listed = client.get("/workspaces").json()["workspaces"]
    assert all(item["workspace"] != "broken_ws" for item in listed)

    listed_with_deleted = client.get(
        "/workspaces?include_deleted=true",
        headers={"Authorization": f"Bearer {_build_token('alice', 'user')}"},
    ).json()["workspaces"]
    assert any(
        item["workspace"] == "broken_ws" and item["status"] == "create_failed"
        for item in listed_with_deleted
    )


def test_create_workspace_retry_reuses_failed_record(workspace_app_factory):
    attempts = {"count": 0}

    async def _flaky_initializer(_: str) -> None:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("seed init failed")

    client, store, _ = workspace_app_factory(workspace_initializer=_flaky_initializer)
    payload = {
        "workspace": "retry_ws",
        "display_name": "Retry",
        "description": "retry workspace",
        "visibility": "private",
    }
    headers = {"Authorization": f"Bearer {_build_token('alice', 'user')}"}

    first = client.post("/workspaces", json=payload, headers=headers)
    assert first.status_code == 500

    second = client.post("/workspaces", json=payload, headers=headers)
    assert second.status_code == 201
    assert second.json()["status"] == "ready"

    stored = asyncio.run(store.get_workspace("retry_ws"))
    assert stored["status"] == "ready"

    operation = asyncio.run(store.get_workspace_operation("retry_ws"))
    assert operation["state"] == "idle"
