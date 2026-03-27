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

    await store.begin_hard_delete("books", requested_by="admin")
    await store.fail_hard_delete("books", "boom")
    failed = await store.get_workspace("books")
    assert failed["status"] == "delete_failed"
    assert failed["delete_error"] == "boom"

    await store.begin_hard_delete("books", requested_by="admin")
    await store.complete_hard_delete("books")
    deleted = await store.get_workspace("books")
    operation = await store.get_workspace_operation("books")

    assert deleted["status"] == "hard_deleted"
    assert operation["state"] == "completed"
