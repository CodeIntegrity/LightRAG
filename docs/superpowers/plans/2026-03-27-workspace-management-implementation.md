# Workspace Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end workspace management to LightRAG, including backend registry/runtime support, authenticated workspace CRUD and delete workflows, and a WebUI global workspace switcher plus management dialog.

**Architecture:** Introduce a SQLite-backed workspace registry and a per-request workspace runtime layer inside the FastAPI server, then thread current-workspace selection through the WebUI via a persisted setting and request header. Keep deletion safe by gating workspaces with `hard_deleting`, draining active requests, and executing hard delete in a dedicated background executor with persisted progress.

**Tech Stack:** Python, FastAPI, sqlite3, pytest via `./scripts/test.sh`, Bun, React 19, Zustand, Vitest, Vite

---

## File Structure

- Create: `lightrag/api/workspace_registry.py`
  - SQLite-backed workspace registry store and operation progress persistence.
- Create: `lightrag/api/workspace_runtime.py`
  - Runtime bundle, runtime cache, request refcounting, and drain-aware runtime manager.
- Create: `lightrag/api/routers/workspace_routes.py`
  - Workspace list/create/get/stats/delete/restore/operation endpoints, including stats capability metadata.
- Create: `lightrag/tools/migrate_workspaces.py`
  - Explicit CLI migration utility for legacy workspaces with `--workspace`, `--from-file`, `--discover-local`, `--owner`, `--visibility`, and `--on-conflict`.
- Modify: `lightrag/api/config.py`
  - Add config/env parsing for registry path, busy timeout, runtime cache, and delete executor controls.
- Modify: `lightrag/api/auth.py`
  - Add `AUTH_ADMIN_USERS` role issuance support.
- Modify: `lightrag/api/lightrag_server.py`
  - Initialize registry/runtime manager, add workspace middleware/context, wire new router, and update `/health`.
- Modify: `lightrag/api/routers/document_routes.py`
  - Resolve actual runtime/doc manager for background-task scheduling and workspace-aware operations.
- Modify: `lightrag/api/routers/query_routes.py`
  - Use workspace-aware runtime access.
- Modify: `lightrag/api/routers/graph_routes.py`
  - Use workspace-aware runtime access.
- Modify: `lightrag/api/routers/prompt_config_routes.py`
  - Resolve prompt version store from the selected workspace runtime.
- Modify: `pyproject.toml`
  - Register `lightrag-migrate-workspaces`.
- Modify: `.env.example`
  - Document newly introduced workspace-management env vars.
- Create: `tests/test_workspace_registry_store.py`
- Create: `tests/test_workspace_runtime_manager.py`
- Create: `tests/test_workspace_management_routes.py`
- Create: `tests/test_workspace_migration.py`
- Modify: `tests/test_auth.py`
  - Extend auth coverage for `admin` role issuance.
- Modify: `lightrag_webui/src/api/lightrag.ts`
  - Add workspace APIs and inject `LIGHTRAG-WORKSPACE`.
- Modify: `lightrag_webui/src/stores/settings.ts`
  - Persist current workspace and workspace-scoped UI state.
- Modify: `lightrag_webui/src/stores/state.ts`
  - Make backend health checks workspace-aware.
- Modify: `lightrag_webui/src/features/SiteHeader.tsx`
  - Mount global workspace switcher trigger.
- Create: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`
- Create: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- Create: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`
- Create: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`
- Create: `lightrag_webui/src/api/lightrag.workspace.test.ts`

## Task 1: Registry And Auth Foundation

**Files:**
- Create: `tests/test_workspace_registry_store.py`
- Modify: `tests/test_auth.py`
- Create: `lightrag/api/workspace_registry.py`
- Modify: `lightrag/api/auth.py`
- Modify: `lightrag/api/config.py`

- [ ] **Step 1: Write the failing registry and auth tests**

```python
async def test_create_workspace_persists_sqlite_record(tmp_path: Path):
    store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
    await store.initialize(default_workspace="")
    record = await store.create_workspace("books", "Books", "desc", "alice", "private")
    assert record["workspace"] == "books"
    assert record["created_by"] == "alice"

def test_auth_handler_issues_admin_role(monkeypatch):
    monkeypatch.setattr(auth_module.global_args, "auth_admin_users", "admin,root")
    handler = AuthHandler()
    token = handler.create_token("admin", role=handler.resolve_role("admin"))
    payload = handler.validate_token(token)
    assert payload["role"] == "admin"

@pytest.mark.asyncio
async def test_concurrent_workspace_creation_race(tmp_path: Path):
    store = WorkspaceRegistryStore(tmp_path / "registry.sqlite3")
    await store.initialize(default_workspace="")
    tasks = [
        store.create_workspace("books", "Books", "desc", "alice", "private")
        for _ in range(5)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert sum(1 for item in results if not isinstance(item, Exception)) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_workspace_registry_store.py tests/test_auth.py -q`
Expected: FAIL because `WorkspaceRegistryStore` and admin-role support do not exist yet

- [ ] **Step 3: Implement the minimal registry and admin-role support**

```python
class WorkspaceRegistryStore:
    async def initialize(self, default_workspace: str) -> None: ...
    async def create_workspace(...): ...

class AuthHandler:
    def resolve_role(self, username: str) -> str:
        return "admin" if username in self.admin_users else "user"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_workspace_registry_store.py tests/test_auth.py -q`
Expected: PASS

## Task 2: Runtime Manager And Workspace Context

**Files:**
- Create: `tests/test_workspace_runtime_manager.py`
- Create: `lightrag/api/workspace_runtime.py`
- Modify: `lightrag/api/lightrag_server.py`

- [ ] **Step 1: Write the failing runtime-manager tests**

```python
@pytest.mark.asyncio
async def test_runtime_manager_reuses_bundle_for_same_workspace(...):
    bundle1 = await manager.acquire_runtime("books")
    bundle2 = await manager.acquire_runtime("books")
    assert bundle1 is bundle2

@pytest.mark.asyncio
async def test_runtime_manager_blocks_new_requests_when_hard_deleting(...):
    await manager.mark_workspace_draining("books")
    with pytest.raises(WorkspaceStateError):
        await manager.acquire_runtime("books")

@pytest.mark.asyncio
async def test_wait_for_drain_timeout_reports_failure(...):
    await manager.mark_workspace_draining("books")
    drained = await manager.wait_for_drain("books", timeout_seconds=0.01)
    assert drained is False

@pytest.mark.asyncio
async def test_runtime_cache_evicts_idle_workspaces_when_full(...):
    manager = WorkspaceRuntimeManager(factory, max_cached_workspaces=1, idle_ttl_seconds=0)
    ...
    evicted = await manager.prune_idle_runtimes()
    assert "ws1" in evicted
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_workspace_runtime_manager.py -q`
Expected: FAIL because runtime manager does not exist yet

- [ ] **Step 3: Implement minimal runtime manager and request workspace context**

```python
@dataclass
class WorkspaceRuntimeBundle:
    workspace: str
    rag: LightRAG
    doc_manager: DocumentManager
    accepting_requests: bool = True
    active_requests: int = 0

class WorkspaceRuntimeManager:
    async def acquire_runtime(self, workspace: str) -> WorkspaceRuntimeBundle: ...
    async def release_runtime(self, workspace: str) -> None: ...
    async def wait_for_drain(self, workspace: str, timeout_seconds: float) -> bool: ...
    async def prune_idle_runtimes(self) -> list[str]: ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_workspace_runtime_manager.py -q`
Expected: PASS

## Task 3a: Workspace Routes, Health, And Stats

**Files:**
- Create: `tests/test_workspace_management_routes.py`
- Create: `lightrag/api/routers/workspace_routes.py`
- Modify: `lightrag/api/lightrag_server.py`
- Modify: `lightrag/api/routers/prompt_config_routes.py`

- [ ] **Step 1: Write the failing API route tests**

```python
def test_list_workspaces_returns_registry_records(client):
    response = client.get("/workspaces")
    assert response.status_code == 200
    assert "workspaces" in response.json()

def test_workspace_stats_include_capabilities(client):
    response = client.get("/workspaces/books/stats")
    assert response.status_code == 200
    assert "capabilities" in response.json()

def test_hard_delete_returns_202_with_operation_payload(client, admin_headers):
    response = client.post("/workspaces/books/hard-delete", headers=admin_headers)
    assert response.status_code == 202
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_workspace_management_routes.py -q`
Expected: FAIL because routes are not registered yet

- [ ] **Step 3: Implement workspace routes and wire runtime-aware health/prompt routes**

```python
app.include_router(create_workspace_routes(...))

@router.get("/workspaces")
async def list_workspaces(...): ...

@router.get("/workspaces/{workspace}/stats")
async def get_workspace_stats(...):
    return {"document_count": ..., "capabilities": {...}}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_workspace_management_routes.py -q`
Expected: PASS

## Task 3b: Business Routes Runtime Refactor

**Files:**
- Create: `tests/test_workspace_runtime_app_integration.py`
- Modify: `lightrag/api/lightrag_server.py`
- Modify: `lightrag/api/routers/document_routes.py`
- Modify: `lightrag/api/routers/query_routes.py`
- Modify: `lightrag/api/routers/graph_routes.py`

- [ ] **Step 1: Write the failing route-runtime tests**

```python
def test_graph_routes_resolve_runtime_from_workspace_header(client):
    ...

def test_document_routes_schedule_background_work_with_current_runtime(client):
    ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_workspace_runtime_app_integration.py -q`
Expected: FAIL because business routes still close over the startup runtime

- [ ] **Step 3: Refactor business routes to use workspace runtime**

```python
runtime = await runtime_manager.acquire_runtime(workspace)
try:
    ...
finally:
    await runtime_manager.release_runtime(workspace)
```

- [ ] **Step 4: Update document background-task scheduling to pass concrete runtime/doc manager objects**

```python
current_rag, current_doc_manager = _current_runtime_objects()
background_tasks.add_task(run_scanning_process, current_rag, current_doc_manager, track_id)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_workspace_runtime_app_integration.py tests/test_prompt_config_routes.py -q`
Expected: PASS

## Task 4: Hard Delete Executor And Migration CLI

**Files:**
- Create: `tests/test_workspace_migration.py`
- Modify: `lightrag/api/workspace_runtime.py`
- Create: `lightrag/tools/migrate_workspaces.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Write the failing migration and delete-progress tests**

```python
def test_migrate_workspaces_dry_run_reports_candidates(...):
    result = run_cli("--discover-local", "--dry-run")
    assert "books" in result.stdout

def test_migrate_workspaces_conflict_mode_error_exits_non_zero(...):
    result = run_cli("--workspace", "books", "--on-conflict", "error")
    assert result.exit_code != 0

def test_migrate_workspaces_from_file_uses_explicit_names(...):
    result = run_cli("--from-file", "workspaces.txt", "--owner", "admin")
    assert result.exit_code == 0

@pytest.mark.asyncio
async def test_hard_delete_retry_skips_completed_steps(...):
    await manager.record_delete_progress("books", {"storage_drop": "done"})
    ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_workspace_migration.py tests/test_workspace_runtime_manager.py -q`
Expected: FAIL because the CLI and retryable delete progress are incomplete

- [ ] **Step 3: Implement the CLI and delete executor progress behavior**

```python
def main() -> int:
    parser.add_argument("--workspace", action="append")
    parser.add_argument("--from-file")
    parser.add_argument("--discover-local", action="store_true")
    parser.add_argument("--owner")
    parser.add_argument("--visibility", choices=["public", "private"], default="public")
    parser.add_argument("--on-conflict", choices=["error", "skip"], default="error")
    parser.add_argument("--dry-run", action="store_true")
```

Note: `merge` is intentionally out of scope for `--on-conflict` in v1. Updating metadata for an already-registered workspace is too ambiguous to automate safely in the migration command.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_workspace_migration.py tests/test_workspace_runtime_manager.py -q`
Expected: PASS

## Task 5: WebUI Workspace Data Layer

**Files:**
- Create: `lightrag_webui/src/api/lightrag.workspace.test.ts`
- Modify: `lightrag_webui/src/api/lightrag.ts`
- Modify: `lightrag_webui/src/stores/settings.ts`
- Modify: `lightrag_webui/src/stores/state.ts`

- [ ] **Step 1: Write the failing frontend API/store tests**

```ts
test('axios interceptor sends LIGHTRAG-WORKSPACE header', async () => {
  useSettingsStore.setState({ currentWorkspace: 'books' })
  ...
  expect(headers['LIGHTRAG-WORKSPACE']).toBe('books')
})

test('workspace switching resets workspace-scoped prompt selection', async () => {
  ...
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd lightrag_webui && bun test src/api/lightrag.workspace.test.ts`
Expected: FAIL because workspace header and APIs are missing

- [ ] **Step 3: Implement workspace APIs and store state**

```ts
config.headers['LIGHTRAG-WORKSPACE'] = currentWorkspace
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd lightrag_webui && bun test src/api/lightrag.workspace.test.ts`
Expected: PASS

## Task 6: WebUI Switcher And Manager Dialog

**Files:**
- Create: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`
- Create: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- Create: `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`
- Create: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`
- Modify: `lightrag_webui/src/features/SiteHeader.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
test('switcher shows current workspace and opens manager dialog', async () => {
  render(<WorkspaceSwitcher />)
  expect(screen.getByText('default')).toBeInTheDocument()
})

test('admin-only actions are hidden for non-admin users', async () => {
  ...
})

test('hard delete requires typing workspace name', async () => {
  ...
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd lightrag_webui && bun test src/components/workspace/WorkspaceSwitcher.test.tsx src/components/workspace/WorkspaceManagerDialog.test.tsx`
Expected: FAIL because components do not exist yet

- [ ] **Step 3: Implement minimal switcher and manager dialog**

```tsx
export function WorkspaceSwitcher() {
  return <Button>{currentWorkspace}</Button>
}
```

- [ ] **Step 4: Run tests and build to verify they pass**

Run: `cd lightrag_webui && bun test src/components/workspace/WorkspaceSwitcher.test.tsx src/components/workspace/WorkspaceManagerDialog.test.tsx && bun run build`
Expected: PASS

## Task 7: Targeted Integration Verification

**Files:**
- Test: `tests/test_workspace_management_routes.py`
- Test: `tests/test_workspace_runtime_app_integration.py`
- Test: `tests/test_workspace_migration.py`
- Test: `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`

- [ ] **Step 1: Add end-to-end backend workflow coverage**

```python
def test_workspace_full_lifecycle_via_api(...):
    # create -> query-capable -> soft delete -> restore -> hard delete
    ...
```

- [ ] **Step 2: Add migration CLI integration coverage with real local legacy workspace fixtures**

Run: `./scripts/test.sh tests/test_workspace_migration.py -q`
Expected: PASS with explicit fixtures and conflict handling

- [ ] **Step 3: Run targeted verification suites**

Run: `./scripts/test.sh tests/test_workspace_registry_store.py tests/test_workspace_runtime_manager.py tests/test_workspace_management_routes.py tests/test_workspace_runtime_app_integration.py tests/test_workspace_migration.py tests/test_prompt_config_routes.py tests/test_auth.py -q`
Expected: PASS

- [ ] **Step 4: Run frontend verification**

Run: `cd lightrag_webui && bun test && bun run build`
Expected: PASS

## Rollback Notes

- Registry persistence is isolated to the new workspace registry database and should not rewrite existing RAG data files in place.
- If rollout fails before migration is relied upon, rollback is a normal code/deploy rollback plus removal of the registry file in non-production environments.
- No runtime feature flag is planned in v1; adding `LIGHTRAG_ENABLE_WORKSPACE_MANAGEMENT` would itself be another cross-cutting feature and is intentionally excluded from this plan.
