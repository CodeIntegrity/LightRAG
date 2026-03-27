from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
import time
from typing import Any, Awaitable, Callable


class WorkspaceStateError(RuntimeError):
    """Raised when a workspace runtime cannot accept new requests."""


@dataclass
class WorkspaceRuntimeBundle:
    workspace: str
    rag: Any
    doc_manager: Any
    accepting_requests: bool = True
    active_requests: int = 0
    last_used_at: float = field(default_factory=time.monotonic)


_current_workspace: ContextVar[str | None] = ContextVar(
    "lightrag_current_workspace", default=None
)
_current_runtime: ContextVar[WorkspaceRuntimeBundle | None] = ContextVar(
    "lightrag_current_runtime", default=None
)


def get_current_workspace() -> str | None:
    return _current_workspace.get()


def get_current_runtime() -> WorkspaceRuntimeBundle | None:
    return _current_runtime.get()


def bind_current_runtime(bundle: WorkspaceRuntimeBundle) -> tuple[Token, Token]:
    return _current_workspace.set(bundle.workspace), _current_runtime.set(bundle)


def reset_current_runtime(tokens: tuple[Token, Token]) -> None:
    workspace_token, runtime_token = tokens
    _current_runtime.reset(runtime_token)
    _current_workspace.reset(workspace_token)


class WorkspaceRuntimeProxy:
    """Proxy that resolves attributes against the current request runtime bundle."""

    def __init__(
        self,
        accessor: Callable[[WorkspaceRuntimeBundle], Any],
        path: tuple[str, ...] = (),
    ) -> None:
        object.__setattr__(self, "_accessor", accessor)
        object.__setattr__(self, "_path", path)

    def _resolve(self) -> Any:
        bundle = get_current_runtime()
        if bundle is None:
            raise RuntimeError("No workspace runtime is bound to the current context")
        target = self._accessor(bundle)
        for segment in self._path:
            target = getattr(target, segment)
        return target

    def __getattr__(self, name: str) -> Any:
        target = getattr(self._resolve(), name)
        if callable(target):
            return target
        return WorkspaceRuntimeProxy(self._accessor, self._path + (name,))


class WorkspaceRuntimeManager:
    def __init__(
        self,
        runtime_factory: Callable[[str], Awaitable[WorkspaceRuntimeBundle]],
        close_bundle: Callable[[WorkspaceRuntimeBundle], Awaitable[None]] | None = None,
        *,
        max_cached_workspaces: int = 10,
        idle_ttl_seconds: float = 3600,
        time_fn: Callable[[], float] | None = None,
    ) -> None:
        self._runtime_factory = runtime_factory
        self._close_bundle = close_bundle
        self.max_cached_workspaces = max_cached_workspaces
        self.idle_ttl_seconds = idle_ttl_seconds
        self._time_fn = time_fn or time.monotonic
        self._cache: dict[str, WorkspaceRuntimeBundle] = {}
        self._draining_workspaces: set[str] = set()
        self._lock = asyncio.Lock()

    async def acquire_runtime(self, workspace: str) -> WorkspaceRuntimeBundle:
        async with self._lock:
            if workspace in self._draining_workspaces:
                raise WorkspaceStateError(
                    f"Workspace '{workspace}' is draining and cannot accept new requests"
                )

            bundle = self._cache.get(workspace)
            if bundle is None:
                bundle = await self._runtime_factory(workspace)
                self._cache[workspace] = bundle

            if not bundle.accepting_requests:
                raise WorkspaceStateError(
                    f"Workspace '{workspace}' is not accepting new requests"
                )

            bundle.active_requests += 1
            bundle.last_used_at = self._time_fn()
            return bundle

    async def release_runtime(self, workspace: str) -> None:
        async with self._lock:
            bundle = self._cache.get(workspace)
            if bundle is None:
                return
            bundle.active_requests = max(bundle.active_requests - 1, 0)
            bundle.last_used_at = self._time_fn()

    async def mark_workspace_draining(self, workspace: str) -> None:
        async with self._lock:
            self._draining_workspaces.add(workspace)
            bundle = self._cache.get(workspace)
            if bundle is not None:
                bundle.accepting_requests = False

    async def mark_workspace_ready(self, workspace: str) -> None:
        async with self._lock:
            self._draining_workspaces.discard(workspace)
            bundle = self._cache.get(workspace)
            if bundle is not None:
                bundle.accepting_requests = True

    async def wait_for_drain(
        self, workspace: str, timeout_seconds: float, poll_interval: float = 0.05
    ) -> bool:
        deadline = self._time_fn() + timeout_seconds
        while self._time_fn() <= deadline:
            async with self._lock:
                bundle = self._cache.get(workspace)
                if bundle is None or bundle.active_requests == 0:
                    return True
            await asyncio.sleep(poll_interval)
        return False

    async def evict_runtime(self, workspace: str) -> WorkspaceRuntimeBundle | None:
        async with self._lock:
            bundle = self._cache.get(workspace)
            if bundle is None:
                return None
            if bundle.active_requests > 0:
                raise WorkspaceStateError(
                    f"Workspace '{workspace}' still has active requests"
                )
            self._cache.pop(workspace, None)

        if self._close_bundle is not None:
            await self._close_bundle(bundle)
        return bundle

    async def prune_idle_runtimes(self) -> list[str]:
        async with self._lock:
            now = self._time_fn()
            candidates = [
                bundle
                for bundle in self._cache.values()
                if bundle.active_requests == 0
                and bundle.workspace not in self._draining_workspaces
                and now - bundle.last_used_at >= self.idle_ttl_seconds
            ]
            overflow = max(len(self._cache) - self.max_cached_workspaces, 0)
            candidates.sort(key=lambda item: item.last_used_at)
            workspaces_to_evict = [bundle.workspace for bundle in candidates]
            if overflow > 0:
                for bundle in self._cache.values():
                    if (
                        bundle.active_requests == 0
                        and bundle.workspace not in self._draining_workspaces
                        and bundle.workspace not in workspaces_to_evict
                    ):
                        workspaces_to_evict.append(bundle.workspace)
                        if len(workspaces_to_evict) >= overflow:
                            break

        evicted: list[str] = []
        for workspace in workspaces_to_evict:
            removed = await self.evict_runtime(workspace)
            if removed is not None:
                evicted.append(workspace)
        return evicted

    @asynccontextmanager
    async def runtime_scope(self, workspace: str):
        bundle = await self.acquire_runtime(workspace)
        try:
            yield bundle
        finally:
            await self.release_runtime(workspace)
