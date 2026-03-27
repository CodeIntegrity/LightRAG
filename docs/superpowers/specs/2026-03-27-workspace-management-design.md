# LightRAG Workspace Management Design

**Date:** 2026-03-27

**Status:** Approved for implementation planning

## Goal

Add first-class workspace management to LightRAG WebUI and API so users can create, delete, restore, and switch workspaces safely from a single server instance while preserving LightRAG's existing workspace-based data isolation model.

## Approved Product Decisions

The following decisions were validated during brainstorming and are treated as fixed inputs for implementation planning:

- Workspace management must include both WebUI controls and backend management APIs
- WebUI must support:
  - create workspace
  - soft delete workspace
  - restore workspace
  - hard delete workspace
  - switch workspace
- Workspace switching is global to the whole WebUI session
- Soft delete and hard delete must both exist
- Hard delete must require a formal `admin` permission, not just "logged-in user"
- Workspace metadata should use a lightweight registry model

## Scope

This design covers:

- A server-side workspace registry
- A workspace-aware runtime manager for API routes
- Global workspace switching in WebUI
- WebUI workspace management surfaces
- Formal role-aware permission checks for destructive workspace actions
- Async hard delete workflow with progress state
- Explicit migration of legacy workspaces into the managed registry
- Tests for backend and frontend behavior

This design does not cover:

- Workspace renaming
- Multi-server distributed workspace coordination
- Per-workspace quotas or billing
- Multi-user ownership and sharing workflows
- Audit trails beyond lightweight operator metadata
- Automatic re-index or migration after workspace changes
- Batch destructive workspace operations in the first iteration

## Current State

Today, LightRAG already has a real workspace isolation concept, but it is not yet exposed as a complete management system.

Existing foundations:

- `lightrag/api/lightrag_server.py` reads `LIGHTRAG-WORKSPACE` from request headers for `/health`
- `LightRAG` and storage implementations already accept `workspace`
- `DocumentManager` already isolates `input_dir/<workspace>`
- Prompt version persistence is already workspace-scoped
- Storage implementations already expose a common `drop()` contract for "clear current workspace data"

Current gaps:

- Most business routes still use the single startup `rag` instance rather than resolving workspace per request
- There is no workspace registry or workspace list API
- WebUI has no global workspace selector
- WebUI request interception does not consistently propagate a current workspace header
- Authentication currently distinguishes `guest` vs logged-in users, but not a formal `admin` role used by route-level authorization
- Existing long-running API work mainly relies on FastAPI `BackgroundTasks`, which is not sufficient as the sole safety model for high-risk workspace hard delete

## Chosen Approach

Use a request-header-driven architecture with a lightweight SQLite-backed registry and a workspace-aware runtime manager.

This means:

- WebUI stores the current workspace locally and sends it via `LIGHTRAG-WORKSPACE`
- Backend resolves the target workspace for every relevant route
- Backend uses a `WorkspaceRuntimeManager` to lazily create and cache `LightRAG` runtimes per workspace
- Backend uses a `WorkspaceRegistryStore` as the source of truth for list/create/delete/restore state
- Workspace creation and deletion become explicit management operations
- Workspace switching remains a cheap context switch, not a server-global mutation
- Unknown non-registered workspaces are rejected by default rather than auto-adopted from request headers
- Legacy workspaces enter the new system through explicit migration, not accidental first access

This approach is preferred over URL-based `/workspaces/{id}/...` rewrites or multi-instance orchestration because it preserves current LightRAG concepts while minimizing route churn.

## Design Principles

- Keep `workspace` as the primary tenant identifier everywhere
- Make the registry explicit, but lightweight enough to ship as a single local SQLite file
- Preserve backward compatibility for existing workspace-aware API clients where feasible
- Make switching cheap and visible
- Treat hard delete as an async, dangerous, stateful operation
- Keep destructive behavior honest across heterogeneous storage backends
- Do not silently sanitize invalid workspace names at creation time
- Separate session-level "current workspace" from server-level default workspace
- Prefer transaction-backed safety over ad hoc file-locking for multi-worker correctness
- Make delete and retry flows idempotent wherever backend contracts allow it

## Core Concepts

### Workspace Identity

Workspace identity remains the existing `workspace` string. No additional UUID is introduced for first iteration.

Reasons:

- Existing storage isolation is already keyed by workspace string
- Input directories already use the workspace name
- Prompt version storage already uses workspace-relative paths
- Request routing already understands a workspace header

### Default Workspace vs Current Workspace

Two concepts must stay distinct:

- `default workspace`: the server's fallback workspace when no request header is provided
- `current workspace`: the workspace selected in the active WebUI session

The server must not persist a global "active workspace" for all users.

First-iteration rule:

- the default workspace is a read-only mirror of server configuration
- changing `default_workspace` is out of scope for workspace management APIs in this phase
- the default workspace is always treated as protected

### Registered vs Legacy Workspaces

The new registry becomes the source of truth for managed workspaces.

First-iteration behavior:

- the default workspace is auto-registered on startup if missing
- newly created workspaces are always written to the registry first
- non-registered non-default workspaces are rejected by managed APIs and normal business routes
- WebUI only exposes registered workspaces in its selector and management panel
- legacy workspace data must be imported through an explicit migration step

## Persistence Model

### Workspace Registry

Registry path:

```text
<working_dir>/workspaces/registry.sqlite3
```

Suggested schema:

```sql
CREATE TABLE workspaces (
  workspace TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('ready', 'soft_deleted', 'hard_deleting', 'hard_deleted', 'delete_failed')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')) DEFAULT 'public',
  created_by TEXT,
  owners_json TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_error TEXT
);

CREATE TABLE workspace_operations (
  workspace TEXT PRIMARY KEY REFERENCES workspaces(workspace) ON DELETE CASCADE,
  kind TEXT,
  state TEXT NOT NULL CHECK (state IN ('idle', 'running', 'failed', 'completed')),
  requested_by TEXT,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  progress_json TEXT NOT NULL DEFAULT '{}'
);
```

Suggested record semantics:

- `created_by` records the creator username or `system`
- `owners_json` stores owner usernames for future ACL growth
- `visibility` provides first-iteration public/private scoping
- `is_default` and `is_protected` prevent accidental deletion of critical workspaces
- `progress_json` records hard delete step completion for idempotent retry

### Concurrency and Safety

The registry must be safe under multi-process Gunicorn/Uvicorn deployments.

Recommended rules:

- use SQLite with WAL mode enabled
- set `PRAGMA busy_timeout = 5000`
- all registry writes occur inside transactions
- state transitions that gate destructive actions use `BEGIN IMMEDIATE`
- rely on unique constraints rather than "check then write" logic for workspace creation races
- treat the registry as the concurrency control source of truth for:
  - create workspace
  - soft delete
  - restore
  - hard delete start / retry / completion

Why SQLite over JSON + file locks:

- `aiosqlite` is already present in the dependency lock
- SQLite provides transactional semantics across workers
- row-level state transition logic is easier to reason about than hand-rolled lock files
- it avoids subtle races between registry mutation and operation status updates
- workspace management writes are expected to be low-frequency enough that serialized SQLite writes are acceptable in first iteration

If `busy_timeout` is exceeded during a registry write:

- fail the operation rather than blocking indefinitely
- return a retryable server error with `error_code=WORKSPACE_REGISTRY_BUSY`

### Workspace Name Rules

Creation-time validation should require:

- pattern: `[A-Za-z0-9_]+`
- non-empty
- unique among non-hard-deleted workspaces

Invalid names should fail fast with a `400` response. The management API should not silently mutate the requested name.

### Status Model

Suggested workspace status values:

- `ready`
- `soft_deleted`
- `hard_deleting`
- `hard_deleted`
- `delete_failed`

Suggested operation state values:

- `idle`
- `running`
- `failed`
- `completed`

The registry should stay lightweight, but operation progress is explicit rather than implicit:

- workspace status lives in `workspaces`
- operation state and step progress live in `workspace_operations`

## Permission Model

### Roles

Formal roles for first iteration:

- `guest`
- `user`
- `admin`

### Auth Configuration

Current authentication should be extended so the JWT role is not just inferred as "guest vs user".

Recommended backward-compatible addition:

- keep `AUTH_ACCOUNTS` for usernames and passwords
- add `AUTH_ADMIN_USERS` as a comma-separated list of usernames that should receive `role=admin`

Token issuance rules:

- unauthenticated guest flow -> `role=guest`
- authenticated username in `AUTH_ADMIN_USERS` -> `role=admin`
- all other authenticated users -> `role=user`

### Workspace Permissions

Recommended permissions:

- `guest`
  - can read and switch only `visibility=public` and `status=ready` workspaces
  - cannot create, soft delete, restore, or hard delete
- `user`
  - can create workspace
  - becomes owner of the workspace they create
  - can read and switch:
    - `public` ready workspaces
    - ready private workspaces they own
  - can soft delete owned workspaces
  - can restore owned workspaces
  - cannot hard delete workspace
- `admin`
  - can perform all workspace actions including hard delete
  - can view all workspaces regardless of visibility

First-iteration ACL boundary:

- ownership and visibility are enforced for workspace listing and mutating actions
- full multi-user sharing workflows remain out of scope
- introducing `owners_json` now avoids schema churn for future ACL work

### Protected Workspace Rules

The first iteration should protect the default workspace from delete operations and keep default mutability out of scope.

Recommended behavior:

- soft delete of default workspace: reject
- hard delete of default workspace: reject
- management APIs cannot mutate which workspace is the default
- `is_protected` is reserved for future "pin critical workspace" behavior, but the default workspace is always protected now

This keeps the instance from deleting its own fallback namespace accidentally.

## Backend Architecture

### WorkspaceRegistryStore

Responsibilities:

- initialize SQLite schema and WAL mode
- list workspaces
- create workspace metadata
- soft delete workspace metadata
- restore workspace metadata
- update hard delete operation state
- auto-register default workspace
- expose transactional state transitions for create/delete/retry
- persist visibility, owner, and operation progress metadata

Important properties:

- SQLite-backed
- transaction-safe across workers
- no dependency on query execution
- no ownership of `LightRAG` runtime objects

### WorkspaceRuntimeManager

Responsibilities:

- resolve target workspace from request
- validate workspace state before business execution
- lazily create runtime objects per workspace
- cache workspace runtimes in-process
- track per-workspace active request counts
- stop accepting new requests for workspaces entering `hard_deleting`
- drain active requests before destructive runtime teardown
- invalidate and close runtimes after destructive operations
- expose a single route-facing API such as `get_runtime(request)`

Suggested cached runtime bundle:

```python
{
    "workspace": "books",
    "rag": LightRAG(..., workspace="books"),
    "doc_manager": DocumentManager(..., workspace="books"),
    "accepting_requests": True,
    "active_requests": 0,
    "last_used_at": 0,
}
```

Suggested cache policy:

- configurable `max_cached_workspaces`
- configurable idle TTL such as `workspace_runtime_idle_ttl_seconds`
- LRU-style eviction among idle runtimes only
- never evict:
  - default workspace runtime while it is active
  - any runtime with `active_requests > 0`
  - any workspace in `hard_deleting` until teardown completes

### Runtime Resolution Rules

Recommended precedence:

1. `LIGHTRAG-WORKSPACE` request header
2. server default workspace

Behavior rules:

- `ready` workspace -> allowed
- `soft_deleted` workspace -> reject business requests
- `hard_deleting` workspace -> reject business requests
- `hard_deleted` workspace -> reject business requests
- unknown workspace:
  - if default workspace, auto-register
  - otherwise reject with a workspace-not-registered error

Runtime acquisition contract:

- every successful route acquisition increments `active_requests`
- every request completion decrements it in a `finally` path
- once a workspace is marked `hard_deleting`, `accepting_requests` becomes false before runtime drain starts

## Route Integration

The key architectural change is that routes stop closing over a single startup `rag`.

### Affected Route Families

- document routes
- query routes
- graph routes
- prompt-config routes
- `/health`

### New Pattern

Instead of:

```python
return await rag.query(...)
```

Routes should follow a workspace-aware pattern:

```python
runtime = await runtime_manager.get_runtime(request)
return await runtime.rag.query(...)
```

For document operations, route handlers should use both:

- `runtime.rag`
- `runtime.doc_manager`

Prompt-config routes must also resolve workspace-specific runtime state instead of always using the default startup instance.

## API Design

### List Workspaces

`GET /workspaces`

Behavior:

- returns registered workspaces
- default view returns visible workspaces suitable for switching
- optional `include_deleted=true` includes `soft_deleted`, `hard_deleting`, `delete_failed`, and `hard_deleted`

### Create Workspace

`POST /workspaces`

Request:

```json
{
  "workspace": "books",
  "display_name": "Books",
  "description": "Long-form book corpus",
  "visibility": "private"
}
```

Behavior:

- validate workspace name
- create registry entry with `status=ready`
- set `created_by` to the authenticated user or `system`
- initialize `owners_json` with the creator
- create `input_dir/<workspace>`
- initialize prompt seed versions for that workspace
- do not force heavy storage initialization immediately
- do not auto-switch the caller into the new workspace; switching remains an explicit client action

### Get Workspace

`GET /workspaces/{workspace}`

Behavior:

- return single registry record
- useful for management detail views and operation polling

### Get Workspace Stats

`GET /workspaces/{workspace}/stats`

Behavior:

- returns best-effort statistics for UI display and delete confirmation
- fields may be `null` when a backend cannot provide them cheaply or consistently
- visibility and ownership checks match normal workspace read rules

Suggested response:

```json
{
  "document_count": 1234,
  "entity_count": 5678,
  "relation_count": 4321,
  "chunk_count": 9876,
  "storage_size_bytes": null,
  "prompt_version_count": 8
}
```

Metric availability rules:

- `document_count` should be returned when document status storage can answer it without a full destructive scan
- `prompt_version_count` should be returned when the workspace prompt registry is readable
- `entity_count`, `relation_count`, and `chunk_count` are optional best-effort fields and may be `null` on backends where counting is unavailable or too expensive
- `storage_size_bytes` is typically only available for local filesystem-backed artifacts; remote database-backed workspaces should return `null` unless the backend exposes a cheap and trustworthy size signal
- use `WORKSPACE_STATS_UNAVAILABLE` only when the stats request as a whole cannot be served; partial metric absence should prefer `null` fields in a successful response

### Soft Delete Workspace

`POST /workspaces/{workspace}/soft-delete`

Behavior:

- allowed for `user` and `admin`
- reject default workspace
- reject callers who are neither owner nor admin
- reject if already not `ready`
- mark `status=soft_deleted`
- do not touch storage data
- remove from normal switcher list

### Restore Workspace

`POST /workspaces/{workspace}/restore`

Behavior:

- allowed for `user` and `admin`
- reject callers who are neither owner nor admin
- only valid from `soft_deleted`
- set `status=ready`

### Hard Delete Workspace

`POST /workspaces/{workspace}/hard-delete`

Behavior:

- allowed for `admin` only
- reject default workspace
- reject if pipeline is busy
- reject if already `hard_deleting`
- set operation state to running
- perform deletion asynchronously
- return operation metadata immediately for polling

### Get Workspace Operation

`GET /workspaces/{workspace}/operation`

Behavior:

- returns current hard delete operation metadata from registry
- supports WebUI polling during long-running deletion

### Example Responses

`GET /workspaces`

```json
{
  "workspaces": [
    {
      "workspace": "default",
      "display_name": "default",
      "status": "ready",
      "visibility": "public",
      "is_default": true,
      "is_protected": true
    },
    {
      "workspace": "books",
      "display_name": "Books",
      "status": "ready",
      "visibility": "private",
      "is_default": false,
      "is_protected": false
    }
  ]
}
```

`POST /workspaces/{workspace}/hard-delete` with `202 Accepted`

```json
{
  "workspace": "books",
  "status": "hard_deleting",
  "operation": {
    "kind": "hard_delete",
    "state": "running",
    "requested_by": "admin",
    "started_at": "2026-03-27T09:00:00Z",
    "error": null
  }
}
```

Error response example:

```json
{
  "error_code": "WORKSPACE_PROTECTED",
  "message": "Workspace 'default' is protected and cannot be deleted",
  "details": {}
}
```

## Hard Delete Workflow

Hard delete is the most dangerous flow and must be explicit.

### Preconditions

- caller role is `admin`
- workspace exists
- workspace is not default workspace
- workspace is not already being deleted
- pipeline status for the workspace is not busy

### Execution Steps

1. Begin a registry transaction and atomically transition the workspace into delete mode:
   - `status=hard_deleting`
   - `operation.kind=hard_delete`
   - `operation.state=running`
2. Mark the runtime entry as not accepting new requests
3. Wait for `active_requests` to drain to zero, with bounded timeout and observability logs
4. Evict and close any cached runtime for the workspace
5. Create a dedicated non-cached delete execution context for the target workspace
6. Execute deletion steps, persisting progress after each successful step:
   - storage drops
   - input directory cleanup
   - prompt version directory cleanup
   - registry-owned artifacts cleanup
7. Mark operation complete and set `status=hard_deleted`

### Drain Timeout Rule

The drain timeout must use an explicit fail-safe rule.

Recommended first-iteration behavior:

- `LIGHTRAG_WORKSPACE_DRAIN_TIMEOUT=30`
- if active requests do not drain before timeout:
  - abort the delete before any storage or filesystem cleanup begins
  - restore workspace status from `hard_deleting` back to `ready`
  - mark the operation as failed with `error_code=WORKSPACE_DRAIN_TIMEOUT`
  - re-open the runtime to accept new requests

Chosen safety posture:

- do not force-close active runtime requests in the first iteration
- prefer a failed delete attempt over potentially breaking in-flight user traffic

### Failure Handling

Full rollback is not realistic across heterogeneous storage backends.

First-iteration rule:

- if deletion partially fails, record the failure honestly
- persist step-level progress in `progress_json`
- retry is explicitly idempotent:
  - already-completed steps are skipped
  - missing resources are treated as success for cleanup purposes
- set:
  - `status=delete_failed`
  - `operation.state=failed`
  - `operation.error=<message>`
- keep the workspace visible in management UI for retry

Out of scope for first iteration:

- a "force mark hard_deleted" escape hatch
- automatic rollback of already-deleted backend resources

### Background Execution Model

Deletion may involve:

- graph databases
- vector stores
- file system cleanup
- prompt version directory cleanup

This is too large and too backend-dependent to keep as a synchronous click action.

Required behavior:

- `POST /workspaces/{workspace}/hard-delete` returns quickly with `202 Accepted`
- the real delete work runs in a dedicated background executor, not inline in the request coroutine
- operation state is persisted before execution starts so progress survives request completion

First-iteration recommendation:

- use an app-owned delete executor and persisted registry state
- do not rely on plain FastAPI `BackgroundTasks` as the only safety mechanism for hard delete
- keep the design open for future migration to an external queue if operations grow beyond single-instance needs

## WebUI Design

### Global Workspace Switching

Add a `WorkspaceSwitcher` in the header, positioned as a global context control rather than a page-specific filter.

The switcher should:

- display the current workspace clearly
- list visible `ready` workspaces
- allow quick switching
- provide an entry into full workspace management

### Workspace Management Surface

Use a modal dialog or side sheet instead of a top-level tab.

Reasoning:

- workspace management is global infrastructure, not a peer to document, graph, or retrieval workflows
- it needs to be accessible from anywhere
- destructive actions should stay visually separated from everyday content work

### Management Panel Sections

Recommended sections:

- `Workspaces`
  - ready workspaces
  - quick switch
  - soft delete action
- `Deleted`
  - soft-deleted workspaces
  - restore action
  - admin-only hard delete or retry delete
- `Create Workspace`
  - workspace
  - display name
  - description

### Hard Delete UX

Hard delete must use a strong confirmation flow.

Recommended UX:

- visible to `admin` only
- show best-effort workspace stats before confirmation when available
- warning copy explicitly lists deletion targets:
  - documents
  - graph data
  - vector data
  - prompt versions
  - workspace input directory
- require the operator to type the workspace name to confirm
- require explicit acknowledgment that automatic backup is not guaranteed by the product
- show async progress and final success or failure state

### Frontend State Model

Add `currentWorkspace` to the settings store.

State behavior:

- persist `currentWorkspace`
- attach it to all API requests through axios interception
- initialize an empty per-workspace state namespace on first access rather than assuming it already exists
- prefer workspace-scoped state namespaces for feature state that benefits from recall across switches:
  - `stateByWorkspace[workspace].promptManagement`
  - `stateByWorkspace[workspace].retrieval`
  - `stateByWorkspace[workspace].documents`
  - `stateByWorkspace[workspace].graph`
- still clear truly unsafe transient state on switch, such as in-flight page-local results tied to another workspace
- bound remembered workspace-scoped client state with an LRU cap so dormant workspace tabs do not accumulate unbounded memory

Keep these global preferences unchanged:

- theme
- language
- page-size preferences

## WebUI and API Compatibility Rules

- Switching workspace must not require a special "switch" API call
- A workspace change becomes effective when subsequent requests carry the new header
- `/health` must report the resolved workspace rather than always showing the instance default
- Prompt management must show prompt versions for the currently selected workspace
- Document and graph views must reflect only the selected workspace's data
- Unknown workspace requests must fail explicitly rather than silently create or adopt a workspace

## Error Handling and Error Codes

Workspace-related APIs should use a small explicit error code vocabulary rather than only free-text `detail`.

Suggested response shape:

```json
{
  "error_code": "WORKSPACE_NOT_REGISTERED",
  "message": "Workspace 'books' is not registered",
  "details": {}
}
```

Suggested first-iteration codes:

- `WORKSPACE_NOT_REGISTERED`
- `WORKSPACE_INVALID_NAME`
- `WORKSPACE_ALREADY_EXISTS`
- `WORKSPACE_NOT_READY`
- `WORKSPACE_SOFT_DELETED`
- `WORKSPACE_HARD_DELETING`
- `WORKSPACE_PROTECTED`
- `WORKSPACE_FORBIDDEN`
- `WORKSPACE_DELETE_BUSY`
- `WORKSPACE_DELETE_FAILED`
- `WORKSPACE_OPERATION_ALREADY_RUNNING`
- `WORKSPACE_DRAIN_TIMEOUT`
- `WORKSPACE_MIGRATION_FAILED`
- `WORKSPACE_STATS_UNAVAILABLE`
- `WORKSPACE_REGISTRY_BUSY`

## Migration and Upgrade Path

Because normal request traffic no longer auto-adopts arbitrary workspaces, the upgrade path must be explicit.

Recommended first-iteration path:

- auto-register only the configured default workspace on startup
- provide an admin migration utility to register known legacy workspaces into the SQLite registry
- refuse non-registered workspace requests until they are created or migrated

Suggested migration outputs:

- imported workspace names
- skipped workspace names
- validation failures
- ownership / visibility defaults applied during migration

### Migration Utility Design

The migration tool should be a CLI-first operational utility, not a normal end-user WebUI action.

Recommended shape:

- command name: `lightrag-migrate-workspaces`
- trigger mode: manual only
- startup behavior: no automatic legacy scan during normal server boot

Recommended modes:

- `--workspace <name>` repeated to register explicit legacy workspaces
- `--discover-local` to discover candidate local workspaces from known filesystem clues such as:
  - `input_dir/*`
  - workspace-relative prompt version directories under `working_dir`
- `--dry-run` to preview what would be imported

Important boundary:

- local filesystem discovery is best-effort only
- external-database-only workspaces should be registered by explicit name because automatic discovery is not trustworthy there

## Observability

Add a dedicated observability layer for workspace management.

Recommended logging:

- workspace create / soft delete / restore / hard delete start / hard delete finish / hard delete fail
- runtime cache hit / miss / eviction
- runtime drain timeout
- rejected requests against non-ready workspaces

Recommended metrics:

- workspace switch count
- per-workspace request count
- runtime cache size
- runtime cache eviction count
- workspace registry lock wait duration
- workspace stats query duration
- workspace migration count
- hard delete duration
- hard delete success / failure count
- hard delete drain wait duration

## Internationalization

Workspace management UI must define explicit i18n keys rather than inline strings.

Suggested namespaces:

- `workspaceSwitcher.*`
- `workspaceManager.*`
- `workspaceErrors.*`
- `workspaceDelete.*`

## Configuration Reference

Suggested first-iteration configuration additions:

```bash
# Registry
LIGHTRAG_WORKSPACE_REGISTRY_PATH=./workspaces/registry.sqlite3
LIGHTRAG_WORKSPACE_REGISTRY_BUSY_TIMEOUT_MS=5000

# Runtime manager
LIGHTRAG_MAX_CACHED_WORKSPACES=10
LIGHTRAG_WORKSPACE_RUNTIME_IDLE_TTL=3600

# Hard delete
LIGHTRAG_WORKSPACE_DRAIN_TIMEOUT=30
LIGHTRAG_HARD_DELETE_EXECUTOR_WORKERS=2

# Auth
AUTH_ADMIN_USERS=admin,superuser
```

Deliberately omitted:

- `LIGHTRAG_STRICT_WORKSPACE`

Reason:

- strict registry enforcement is the default product behavior in this design
- first iteration does not introduce a compatibility toggle that re-enables implicit workspace adoption

## Performance and Capacity Assumptions

The first iteration should state explicit non-goals and expected operating range.

Working assumptions:

- tens of active workspaces should be routine
- low hundreds of registered workspaces should remain manageable with SQLite registry lookups
- runtime cache is intentionally bounded and should not attempt to keep every workspace hot
- stats endpoints should be best-effort and may omit expensive values rather than forcing full scans on every request

## Backup and Restore Policy

Automatic cross-backend backup is not guaranteed in the first iteration.

Product rules:

- hard delete does not automatically create a full backup snapshot
- the UI must say this clearly
- operators must explicitly confirm they understand deletion may be irreversible
- backup integration points remain future work because storage backends vary widely

## Testing Strategy

### Backend Tests

Add focused tests for:

- registry create/list/get
- default workspace auto-registration
- explicit legacy workspace migration behavior
- role issuance for `guest`, `user`, `admin`
- permission enforcement per route
- runtime manager cache and invalidation
- runtime request refcount drain behavior
- runtime cache eviction policy
- per-request workspace route resolution
- soft delete / restore transitions
- hard delete success path
- hard delete failure path
- hard delete idempotent retry path
- default workspace protection
- pipeline-busy delete rejection
- concurrent create/delete race handling

Suggested files:

- `tests/test_workspace_registry_store.py`
- `tests/test_workspace_management_routes.py`
- `tests/test_workspace_runtime_manager.py`
- `tests/test_workspace_hard_delete.py`
- `tests/test_auth_roles.py`
- `tests/test_workspace_migration.py`

### Frontend Tests

Add Vitest coverage for:

- header switcher rendering
- request interceptor adding `LIGHTRAG-WORKSPACE`
- workspace switching state updates
- management dialog create/soft-delete/restore flows
- admin-only hard delete UI visibility
- workspace-scoped state persistence on switch
- workspace error-code to i18n mapping

Suggested files:

- `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`
- `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`
- `lightrag_webui/src/api/lightrag.workspace.test.ts`

### Verification Commands

Implementation work should verify at least:

```bash
./scripts/test.sh tests/test_workspace_management_routes.py tests/test_workspace_runtime_manager.py tests/test_workspace_hard_delete.py tests/test_auth_roles.py tests/test_workspace_migration.py -q
cd lightrag_webui && bun test
cd lightrag_webui && bun run build
```

## Rollout Notes

Recommended rollout order:

1. add SQLite registry store, migration utility, and auth role support
2. add runtime manager request refcounting and bounded cache policy
3. refactor routes to resolve workspace per request
4. add workspace management APIs and error code contract
5. add hard delete executor with persisted progress and retry
6. add WebUI global switcher and workspace-scoped state
7. add WebUI management dialog and hard delete UX

## Risks

- Route refactor risk: current business routes assume one startup `rag`
- Storage variation risk: `drop()` semantics differ by backend, especially external stores
- Migration risk: strict registry enforcement can surface unregistered legacy workspaces that previously "just worked"
- UX risk: users may confuse default workspace with current workspace unless the header control is very clear
- Safety risk: hard delete must never look like a reversible action
- Capacity risk: unbounded runtime caching would create memory pressure without explicit limits

## Future Work

- workspace rename and migration tooling
- audit history for workspace operations
- per-workspace ownership and membership
- per-workspace settings beyond prompt versions
- server-side workspace quotas and lifecycle policies
- batch workspace operations once safety semantics are proven
