from pathlib import Path

import pytest


pytestmark = pytest.mark.offline


@pytest.mark.asyncio
async def test_initialize_registers_default_workspace(tmp_path: Path):
    from lightrag.api.workspace_registry import WorkspaceRegistryStore

    store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")

    await store.initialize(default_workspace="")
    records = await store.list_workspaces()

    assert len(records) == 1
    assert records[0]["workspace"] == ""
    assert records[0]["is_default"] is True
    assert records[0]["is_protected"] is True


@pytest.mark.asyncio
async def test_create_workspace_persists_sqlite_record(tmp_path: Path):
    from lightrag.api.workspace_registry import WorkspaceRegistryStore

    store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
    await store.initialize(default_workspace="")

    record = await store.create_workspace(
        workspace="books",
        display_name="Books",
        description="Long-form corpus",
        created_by="alice",
        visibility="private",
    )

    fetched = await store.get_workspace("books")

    assert record["workspace"] == "books"
    assert record["created_by"] == "alice"
    assert record["owners"] == ["alice"]
    assert record["visibility"] == "private"
    assert fetched["workspace"] == "books"
    assert fetched["display_name"] == "Books"


@pytest.mark.asyncio
async def test_begin_hard_delete_records_running_operation(tmp_path: Path):
    from lightrag.api.workspace_registry import WorkspaceRegistryStore

    store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
    await store.initialize(default_workspace="")
    await store.create_workspace(
        workspace="books",
        display_name="Books",
        description="Long-form corpus",
        created_by="alice",
        visibility="private",
    )

    operation = await store.begin_hard_delete("books", requested_by="admin")

    record = await store.get_workspace("books")

    assert record["status"] == "hard_deleting"
    assert operation["workspace"] == "books"
    assert operation["state"] == "running"
    assert operation["requested_by"] == "admin"


@pytest.mark.asyncio
async def test_complete_and_fail_hard_delete_update_workspace_state(tmp_path: Path):
    from lightrag.api.workspace_registry import (
        WorkspaceNotFoundError,
        WorkspaceRegistryStore,
    )

    store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
    await store.initialize(default_workspace="")
    await store.create_workspace(
        workspace="books",
        display_name="Books",
        description="Long-form corpus",
        created_by="alice",
        visibility="private",
    )

    await store.begin_hard_delete("books", requested_by="admin")
    await store.fail_hard_delete("books", "boom")
    failed = await store.get_workspace("books")
    assert failed["status"] == "delete_failed"
    assert failed["delete_error"] == "boom"

    await store.begin_hard_delete("books", requested_by="admin")
    await store.complete_hard_delete("books")
    with pytest.raises(WorkspaceNotFoundError):
        await store.get_workspace("books")
    with pytest.raises(WorkspaceNotFoundError):
        await store.get_workspace_operation("books")

    records = await store.list_workspaces()
    assert [record["workspace"] for record in records] == [""]

    with store._connect() as conn:
        operation_row = conn.execute(
            "SELECT workspace FROM workspace_operations WHERE workspace = ?",
            ("books",),
        ).fetchone()
    assert operation_row is None


@pytest.mark.asyncio
async def test_initialize_purges_legacy_hard_deleted_workspaces(tmp_path: Path):
    from lightrag.api.workspace_registry import WorkspaceRegistryStore

    db_path = tmp_path / "registry.sqlite3"
    store = WorkspaceRegistryStore(db_path)
    await store.initialize(default_workspace="")
    await store.create_workspace(
        workspace="legacy_deleted",
        display_name="Legacy Deleted",
        description="legacy",
        created_by="alice",
        visibility="private",
    )

    with store._connect() as conn:
        conn.execute(
            """
            UPDATE workspaces
            SET status = 'hard_deleted',
                deleted_at = ?,
                deleted_by = ?
            WHERE workspace = ?
            """,
            ("2026-03-30T00:00:00+00:00", "admin", "legacy_deleted"),
        )
        conn.execute(
            """
            UPDATE workspace_operations
            SET kind = 'hard_delete',
                state = 'completed',
                requested_by = ?,
                started_at = ?,
                finished_at = ?
            WHERE workspace = ?
            """,
            (
                "admin",
                "2026-03-30T00:00:00+00:00",
                "2026-03-30T00:00:01+00:00",
                "legacy_deleted",
            ),
        )
        conn.commit()

    reloaded = WorkspaceRegistryStore(db_path)
    await reloaded.initialize(default_workspace="")
    records = await reloaded.list_workspaces()

    assert [record["workspace"] for record in records] == [""]

    with reloaded._connect() as conn:
        operation_row = conn.execute(
            "SELECT workspace FROM workspace_operations WHERE workspace = ?",
            ("legacy_deleted",),
        ).fetchone()
    assert operation_row is None
