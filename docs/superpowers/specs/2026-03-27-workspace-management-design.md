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
- Backward-compatible adoption of existing workspaces
- Tests for backend and frontend behavior

This design does not cover:

- Workspace renaming
- Multi-server distributed workspace coordination
- Per-workspace quotas or billing
- Multi-user ownership and sharing workflows
- Audit trails beyond lightweight operator metadata
- Automatic re-index or migration after workspace changes

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

## Chosen Approach

Use a request-header-driven architecture with a lightweight registry and a workspace-aware runtime manager.

This means:

- WebUI stores the current workspace locally and sends it via `LIGHTRAG-WORKSPACE`
- Backend resolves the target workspace for every relevant route
- Backend uses a `WorkspaceRuntimeManager` to lazily create and cache `LightRAG` runtimes per workspace
- Backend uses a `WorkspaceRegistryStore` as the source of truth for list/create/delete/restore state
- Workspace creation and deletion become explicit management operations
- Workspace switching remains a cheap context switch, not a server-global mutation

This approach is preferred over URL-based `/workspaces/{id}/...` rewrites or multi-instance orchestration because it preserves current LightRAG concepts while minimizing route churn.

## Design Principles

- Keep `workspace` as the primary tenant identifier everywhere
- Make the registry explicit, but keep it lightweight and file-based
- Preserve backward compatibility for existing workspace-aware API clients where feasible
- Make switching cheap and visible
- Treat hard delete as an async, dangerous, stateful operation
- Keep destructive behavior honest across heterogeneous storage backends
- Do not silently sanitize invalid workspace names at creation time
- Separate session-level "current workspace" from server-level default workspace

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

### Registered vs Legacy Workspaces

The new registry becomes the source of truth for managed workspaces, but the design should not strand existing workspace data created before the registry existed.

First-iteration behavior:

- The default workspace is auto-registered on startup if missing
- Newly created workspaces are always written to the registry first
- If a request targets a non-registered workspace and the runtime successfully resolves it, the backend may auto-adopt it into the registry to preserve backward compatibility
- WebUI only exposes registered workspaces in its selector and management panel

## Persistence Model

### Workspace Registry

Registry path:

```text
<working_dir>/workspaces/registry.json
```

Suggested shape:

```json
{
  "version": 1,
  "default_workspace": "",
  "workspaces": [
    {
      "workspace": "default",
      "display_name": "default",
      "description": "Primary workspace",
      "status": "ready",
      "created_at": "2026-03-27T00:00:00Z",
      "updated_at": "2026-03-27T00:00:00Z",
      "created_by": "system",
      "deleted_at": null,
      "deleted_by": null,
      "delete_error": null,
      "operation": {
        "kind": null,
        "state": "idle",
        "requested_by": null,
        "started_at": null,
        "finished_at": null,
        "error": null
      }
    }
  ]
}
```

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

The registry should stay lightweight. Operation status for hard delete may be embedded directly in the workspace record rather than stored in a separate task database.

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
  - can read and switch among visible ready workspaces
  - cannot create, soft delete, restore, or hard delete
- `user`
  - can create workspace
  - can soft delete workspace
  - can restore workspace
  - cannot hard delete workspace
- `admin`
  - can perform all workspace actions including hard delete

### Protected Workspace Rules

The first iteration should protect the default workspace from hard delete.

Recommended behavior:

- soft delete of default workspace: reject
- hard delete of default workspace: reject

This keeps the instance from deleting its own fallback namespace accidentally.

## Backend Architecture

### WorkspaceRegistryStore

Responsibilities:

- read and atomically write `registry.json`
- list workspaces
- create workspace metadata
- soft delete workspace metadata
- restore workspace metadata
- update hard delete operation state
- auto-register default workspace
- optionally auto-adopt legacy workspaces

Important properties:

- file-based
- atomic writes
- no dependency on query execution
- no ownership of `LightRAG` runtime objects

### WorkspaceRuntimeManager

Responsibilities:

- resolve target workspace from request
- validate workspace state before business execution
- lazily create runtime objects per workspace
- cache workspace runtimes in-process
- invalidate runtimes after destructive operations
- expose a single route-facing API such as `get_runtime(request)`

Suggested cached runtime bundle:

```python
{
    "workspace": "books",
    "rag": LightRAG(..., workspace="books"),
    "doc_manager": DocumentManager(..., workspace="books"),
}
```

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
  - otherwise allow optional auto-adoption for backward compatibility if runtime initialization succeeds

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
  "description": "Long-form book corpus"
}
```

Behavior:

- validate workspace name
- create registry entry with `status=ready`
- create `input_dir/<workspace>`
- initialize prompt seed versions for that workspace
- do not force heavy storage initialization immediately
- do not auto-switch the caller into the new workspace; switching remains an explicit client action

### Get Workspace

`GET /workspaces/{workspace}`

Behavior:

- return single registry record
- useful for management detail views and operation polling

### Soft Delete Workspace

`POST /workspaces/{workspace}/soft-delete`

Behavior:

- allowed for `user` and `admin`
- reject default workspace
- reject if already not `ready`
- mark `status=soft_deleted`
- do not touch storage data
- remove from normal switcher list

### Restore Workspace

`POST /workspaces/{workspace}/restore`

Behavior:

- allowed for `user` and `admin`
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

### Get Workspace Operation

`GET /workspaces/{workspace}/operation`

Behavior:

- returns current hard delete operation metadata from registry
- supports WebUI polling during long-running deletion

## Hard Delete Workflow

Hard delete is the most dangerous flow and must be explicit.

### Preconditions

- caller role is `admin`
- workspace exists
- workspace is not default workspace
- workspace is not already being deleted
- pipeline status for the workspace is not busy

### Execution Steps

1. Update registry:
   - `status=hard_deleting`
   - `operation.kind=hard_delete`
   - `operation.state=running`
2. Invalidate cached runtime for the workspace
3. Build or acquire a runtime for the target workspace
4. Call `drop()` on each workspace-bound storage
5. Delete `input_dir/<workspace>`
6. Delete `<working_dir>/<workspace>/prompt_versions`
7. Clean any registry-owned workspace metadata artifacts
8. Mark operation complete and set `status=hard_deleted`

### Failure Handling

Full rollback is not realistic across heterogeneous storage backends.

First-iteration rule:

- if deletion partially fails, record the failure honestly
- set:
  - `status=delete_failed`
  - `operation.state=failed`
  - `operation.error=<message>`
- keep the workspace visible in management UI for retry

### Why Async Delete

Deletion may involve:

- graph databases
- vector stores
- file system cleanup
- prompt version directory cleanup

This is too large and too backend-dependent to keep as a synchronous click action.

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
- warning copy explicitly lists deletion targets:
  - documents
  - graph data
  - vector data
  - prompt versions
  - workspace input directory
- require the operator to type the workspace name to confirm
- show async progress and final success or failure state

### Frontend State Model

Add `currentWorkspace` to the settings store.

State behavior:

- persist `currentWorkspace`
- attach it to all API requests through axios interception
- after switching workspace, reset workspace-sensitive local state:
  - prompt management selection
  - retrieval temporary prompt draft
  - graph page local context
  - document page cached results
  - backend status cache

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

## Testing Strategy

### Backend Tests

Add focused tests for:

- registry create/list/get
- default workspace auto-registration
- legacy workspace auto-adoption behavior
- role issuance for `guest`, `user`, `admin`
- permission enforcement per route
- runtime manager cache and invalidation
- per-request workspace route resolution
- soft delete / restore transitions
- hard delete success path
- hard delete failure path
- default workspace protection
- pipeline-busy delete rejection

Suggested files:

- `tests/test_workspace_registry_store.py`
- `tests/test_workspace_management_routes.py`
- `tests/test_workspace_runtime_manager.py`
- `tests/test_workspace_hard_delete.py`
- `tests/test_auth_roles.py`

### Frontend Tests

Add Vitest coverage for:

- header switcher rendering
- request interceptor adding `LIGHTRAG-WORKSPACE`
- workspace switching state updates
- management dialog create/soft-delete/restore flows
- admin-only hard delete UI visibility
- workspace-sensitive state reset on switch

Suggested files:

- `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`
- `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`
- `lightrag_webui/src/api/lightrag.workspace.test.ts`

### Verification Commands

Implementation work should verify at least:

```bash
./scripts/test.sh tests/test_workspace_management_routes.py tests/test_workspace_runtime_manager.py tests/test_workspace_hard_delete.py tests/test_auth_roles.py -q
cd lightrag_webui && bun test
cd lightrag_webui && bun run build
```

## Rollout Notes

Recommended rollout order:

1. add registry store and auth role support
2. add runtime manager and refactor routes to resolve workspace per request
3. add workspace management APIs
4. add WebUI global switcher
5. add WebUI management dialog
6. add hard delete async progress UX

## Risks

- Route refactor risk: current business routes assume one startup `rag`
- Storage variation risk: `drop()` semantics differ by backend, especially external stores
- Compatibility risk: existing clients may rely on implicit workspace creation
- UX risk: users may confuse default workspace with current workspace unless the header control is very clear
- Safety risk: hard delete must never look like a reversible action

## Future Work

- workspace rename and migration tooling
- audit history for workspace operations
- per-workspace ownership and membership
- per-workspace settings beyond prompt versions
- server-side workspace quotas and lifecycle policies
