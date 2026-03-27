# LightRAG Guest Workspace Creation and Responsive Workspace UI Design

**Date:** 2026-03-27

**Status:** Approved for implementation planning

## Goal

Add a server-side environment variable that controls whether `guest` users may create workspaces, and update the workspace management WebUI so its create-state and layout adapt cleanly across desktop, tablet, and mobile screens.

## Approved Product Decisions

The following decisions were validated during brainstorming and are treated as fixed inputs for implementation planning:

- Keep `guest` as the default role for login-free / auth-disabled access
- Do not introduce a general-purpose "default login role" environment variable
- Add a dedicated boolean environment variable named `ALLOW_GUEST_WORKSPACE_CREATE`
- When `ALLOW_GUEST_WORKSPACE_CREATE=true`, `guest` may create workspaces
- When a `guest` creates a workspace:
  - `created_by='guest'`
  - `owners=['guest']`
- Do not expand `guest` permissions to admin-only operations such as hard delete
- Frontend permission state should come from the backend rather than being inferred locally
- Narrow screens should use a single-column segmented layout in this order:
  - overview
  - create workspace
  - workspaces
  - deleted / pending

## Scope

This design covers:

- backend config support for `ALLOW_GUEST_WORKSPACE_CREATE`
- backend route-level logic for conditional `guest` workspace creation
- exposing workspace creation capability through `/health`
- WebUI state handling for backend-driven workspace creation permissions
- responsive layout adjustments for the workspace management dialog
- tests and docs for the new permission toggle

This design does not cover:

- changing the default JWT role away from `guest`
- allowing anonymous requests without the existing auth flow to create workspaces
- expanding `guest` permissions for restore, hard delete, or other destructive operations
- redesigning the whole workspace feature around route prefixes or a new ACL model
- setup wizard prompt support for the new variable in the first pass

## Current State

Today, workspace creation requires `_require_user()` in `lightrag/api/routers/workspace_routes.py`, which means only `user` and `admin` roles can create workspaces.

Relevant current behavior:

- `guest` is the default non-logged-in / login-free role
- the workspace create route rejects `guest` with `403`
- the WebUI disables the create button when the current role is `guest`
- the WebUI currently relies on local role state for button gating rather than a server capability summary
- the workspace dialog already has an improved visual structure, but it still needs an explicit responsive layout contract so narrow screens do not regress into squeezed side-by-side layouts

## Chosen Approach

Use a narrow, backend-owned permission toggle.

This means:

- add one boolean server config value: `ALLOW_GUEST_WORKSPACE_CREATE`
- keep all existing roles unchanged
- change only the workspace creation authorization path
- expose the capability in `/health` as a workspace permission summary
- let the WebUI render button state and helper copy from that capability summary
- retain server-side enforcement even if the WebUI becomes stale

This is preferred over a generic "default role" variable because it isolates the change to the exact product capability the user wants without widening unrelated permissions.

## Backend Design

### Environment Variable

Add:

```text
ALLOW_GUEST_WORKSPACE_CREATE=false
```

Rules:

- type: boolean
- default: `false`
- read in `lightrag/api/config.py`
- surfaced in `env.example`
- documented in `README.md` and `README-zh.md`

### Authorization Model

Refactor workspace create authorization away from a single hard requirement for `_require_user()`.

Recommended behavior:

- `admin`: always allowed to create workspaces
- `user`: always allowed to create workspaces
- `guest`:
  - allowed only when `ALLOW_GUEST_WORKSPACE_CREATE=true`
  - rejected with `403` when the toggle is `false`

Recommended implementation shape:

- keep `_require_user()` unchanged for routes that still need login
- add a dedicated helper for workspace creation:
  - `_require_workspace_creator(identity, allow_guest_create)`
- avoid using the new helper for hard delete, restore, or other sensitive mutations

This keeps the permission widening local to one route instead of silently changing shared auth helpers.

### Workspace Record Semantics for Guest Creation

When `guest` creation is allowed:

- `created_by` is stored as `"guest"`
- `owners_json` is stored as `["guest"]`

Reasons:

- preserves current registry semantics
- keeps soft-delete / restore ownership rules internally consistent
- avoids special-case null ownership handling
- provides a simple, auditable creator string

### Health Response Capability Summary

Expose workspace creation capability through `/health` so the WebUI can trust server state.

Recommended response shape:

```json
{
  "configuration": {
    "workspace_permissions": {
      "allow_guest_create": true
    }
  }
}
```

This should be treated as a capability summary, not as a full policy language.

## Frontend Design

### Capability Source of Truth

The WebUI should not decide guest creation purely from local JWT role rules anymore.

Recommended behavior:

- derive current role from JWT as before
- derive "may this session create a workspace?" from:
  - `role === 'admin' || role === 'user'`
  - or `role === 'guest' && health.configuration.workspace_permissions.allow_guest_create === true`
- if the health payload is temporarily unavailable:
  - keep logged-in `user/admin` create access enabled
  - keep `guest` create access disabled until the backend capability is known

This biases toward safety while still avoiding false negatives for authenticated users.

### Workspace Dialog Responsive Layout

The workspace dialog should have explicit breakpoint behavior.

#### Desktop

Desktop may keep a two-region layout:

- top: overview cards
- main area:
  - left: create workspace card
  - right: workspaces + deleted / pending cards

The left create column should remain width-bounded so large screens do not produce excessive empty space.

#### Tablet

Tablet should collapse into a single-column segmented flow:

- overview cards
- create workspace
- workspaces
- deleted / pending

Overview cards may still use a compact 2-up wrap if width allows, but the page should no longer depend on a side-by-side create/list split.

#### Mobile

Mobile should use a strict single-column segmented layout:

- overview cards stacked vertically
- create workspace form
- workspace cards
- deleted / pending cards

Mobile rules:

- action buttons wrap or expand full-width as needed
- card metadata stays readable without horizontal compression
- the guest permission hint appears directly above the create button
- secondary capability details remain inside cards and should not force wide grid layouts

### Create-State Messaging

The create card should show different helper copy depending on session capability:

- logged-in `user/admin`:
  - no guest warning
- `guest` with creation enabled:
  - concise informational hint: "This workspace will be created as guest"
- `guest` with creation disabled:
  - concise blocking hint: "Log in to create workspaces"

The hint should be short and visually near the button.

## Error Handling

Server-side enforcement remains authoritative.

Required behavior:

- if the frontend shows create enabled but the backend returns `403`, show a clear toast explaining that workspace creation is currently not allowed for this session
- after such a `403`, trigger a health refresh so the UI re-syncs with server capabilities
- preserve existing error handling for duplicate names, registry errors, and validation failures

This prevents a stale health snapshot from leaving the UI in the wrong state for long.

## Testing Strategy

### Backend

Extend `tests/test_workspace_management_routes.py` to cover:

- `guest` create returns `403` when `ALLOW_GUEST_WORKSPACE_CREATE=false`
- `guest` create returns `201` when `ALLOW_GUEST_WORKSPACE_CREATE=true`
- successful `guest` create stores:
  - `created_by == 'guest'`
  - `owners == ['guest']`

If `/health` tests already exist elsewhere, add one assertion for the new `workspace_permissions.allow_guest_create` field there; otherwise add a focused API test for that summary.

### Frontend

Extend workspace-related WebUI tests to cover:

- guest create button enabled when backend capability allows it
- guest create button disabled when backend capability denies it
- correct guest helper message in both states
- responsive layout class expectations for narrow screens so the create/list sections do not regress into forced side-by-side behavior

### Verification Commands

Expected implementation-time verification:

- `./scripts/test.sh tests/test_workspace_management_routes.py`
- `bun test`
- `bun run build`

## Rollout Notes

- default behavior remains unchanged because the new environment variable defaults to `false`
- existing deployments therefore see no permission widening unless they opt in
- documentation must clearly state that this toggle affects only workspace creation, not destructive workspace administration

## Non-Goals and Guardrails

- do not add a configurable default JWT role
- do not make `guest` equivalent to `user`
- do not use the new toggle to bypass admin-only workspace actions
- do not silently widen permissions beyond the create route

## Implementation Checklist Seed

The later implementation plan should include:

- config and docs updates
- route authorization helper addition
- `/health` capability exposure
- frontend health state plumbing
- workspace dialog permission-driven UI updates
- responsive layout refinement across breakpoints
- backend and frontend test coverage
