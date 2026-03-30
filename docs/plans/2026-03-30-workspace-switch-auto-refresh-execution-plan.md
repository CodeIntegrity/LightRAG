# Workspace switch auto refresh execution plan

## Internal Grade Decision
M — single bounded frontend change with focused regression coverage.

## Wave Structure
### Wave 1
- Update workspace switch behavior in `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`.
- Add regression coverage in `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`.

### Wave 2
- Run targeted frontend tests.
- Record verification and cleanup receipts.

## Ownership Boundaries
- Modify only the workspace dialog component and its test unless validation forces a tighter adjacent change.
- Do not modify backend, API contracts, or unrelated WebUI pages.

## Verification Commands
- `bun test WorkspaceManagerDialog.test.tsx`

## Delivery Acceptance Plan
- Confirm the switch handler persists the selected workspace and triggers a full reload.
- Confirm tests assert reload behavior.

## Completion Language Rules
Only say the task is done after the code is updated and the targeted test command passes.

## Rollback Rules
- If reload breaks persistence expectations, revert to the pre-change switch handler and reassess.
- If SSR-style tests cannot observe reload safely, mock `window.location.reload` rather than broadening runtime behavior.

## Phase Cleanup Expectations
- No temp helper files left behind.
- Emit runtime receipts under `outputs/runtime/vibe-sessions/2026-03-30-workspace-switch-auto-refresh/`.
