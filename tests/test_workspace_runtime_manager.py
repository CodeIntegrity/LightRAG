import asyncio
from types import SimpleNamespace

import pytest


pytestmark = pytest.mark.offline


@pytest.mark.asyncio
async def test_runtime_manager_reuses_cached_bundle_for_same_workspace():
    from lightrag.api.workspace_runtime import WorkspaceRuntimeBundle, WorkspaceRuntimeManager

    factory_calls: list[str] = []

    async def factory(workspace: str) -> WorkspaceRuntimeBundle:
        factory_calls.append(workspace)
        return WorkspaceRuntimeBundle(
            workspace=workspace,
            rag=SimpleNamespace(name=f"rag:{workspace}"),
            doc_manager=SimpleNamespace(name=f"doc:{workspace}"),
        )

    manager = WorkspaceRuntimeManager(factory)

    bundle1 = await manager.acquire_runtime("books")
    await manager.release_runtime("books")
    bundle2 = await manager.acquire_runtime("books")

    assert bundle1 is bundle2
    assert factory_calls == ["books"]
    assert bundle2.active_requests == 1


@pytest.mark.asyncio
async def test_mark_workspace_draining_blocks_new_acquires():
    from lightrag.api.workspace_runtime import WorkspaceRuntimeManager, WorkspaceStateError

    async def factory(workspace: str):
        pytest.fail("factory should not be called for draining workspaces")

    manager = WorkspaceRuntimeManager(factory)
    await manager.mark_workspace_draining("books")

    with pytest.raises(WorkspaceStateError):
        await manager.acquire_runtime("books")


@pytest.mark.asyncio
async def test_wait_for_drain_returns_true_after_release():
    from lightrag.api.workspace_runtime import WorkspaceRuntimeBundle, WorkspaceRuntimeManager

    async def factory(workspace: str) -> WorkspaceRuntimeBundle:
        return WorkspaceRuntimeBundle(
            workspace=workspace,
            rag=SimpleNamespace(),
            doc_manager=SimpleNamespace(),
        )

    manager = WorkspaceRuntimeManager(factory)
    await manager.acquire_runtime("books")

    async def delayed_release():
        await asyncio.sleep(0.05)
        await manager.release_runtime("books")

    release_task = asyncio.create_task(delayed_release())
    drained = await manager.wait_for_drain("books", timeout_seconds=1.0)
    await release_task

    assert drained is True


@pytest.mark.asyncio
async def test_concurrent_same_workspace_acquire_deduplicates_factory_calls():
    from lightrag.api.workspace_runtime import WorkspaceRuntimeBundle, WorkspaceRuntimeManager

    started = asyncio.Event()
    release_factory = asyncio.Event()
    factory_calls: list[str] = []

    async def factory(workspace: str) -> WorkspaceRuntimeBundle:
        factory_calls.append(workspace)
        started.set()
        await release_factory.wait()
        return WorkspaceRuntimeBundle(
            workspace=workspace,
            rag=SimpleNamespace(name=f"rag:{workspace}"),
            doc_manager=SimpleNamespace(name=f"doc:{workspace}"),
        )

    manager = WorkspaceRuntimeManager(factory)
    task1 = asyncio.create_task(manager.acquire_runtime("books"))
    await started.wait()
    task2 = asyncio.create_task(manager.acquire_runtime("books"))
    await asyncio.sleep(0)

    assert factory_calls == ["books"]

    release_factory.set()
    bundle1, bundle2 = await asyncio.gather(task1, task2)

    assert bundle1 is bundle2
    assert bundle1.active_requests == 2


@pytest.mark.asyncio
async def test_concurrent_different_workspaces_cold_start_in_parallel():
    from lightrag.api.workspace_runtime import WorkspaceRuntimeBundle, WorkspaceRuntimeManager

    started: list[str] = []
    ready = {
        "books": asyncio.Event(),
        "notes": asyncio.Event(),
    }

    async def factory(workspace: str) -> WorkspaceRuntimeBundle:
        started.append(workspace)
        await ready[workspace].wait()
        return WorkspaceRuntimeBundle(
            workspace=workspace,
            rag=SimpleNamespace(name=f"rag:{workspace}"),
            doc_manager=SimpleNamespace(name=f"doc:{workspace}"),
        )

    manager = WorkspaceRuntimeManager(factory)
    task1 = asyncio.create_task(manager.acquire_runtime("books"))
    await asyncio.sleep(0)
    task2 = asyncio.create_task(manager.acquire_runtime("notes"))

    async def wait_until_both_started():
        while set(started) != {"books", "notes"}:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait_until_both_started(), timeout=0.2)

    ready["books"].set()
    ready["notes"].set()
    bundle1, bundle2 = await asyncio.gather(task1, task2)

    assert bundle1.workspace == "books"
    assert bundle2.workspace == "notes"
