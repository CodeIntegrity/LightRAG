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
