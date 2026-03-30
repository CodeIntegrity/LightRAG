# Workspace switch auto refresh requirement

## Goal
When a user switches workspace in the WebUI, the application must automatically refresh the page so all views are reloaded under the new workspace context.

## Deliverable
A WebUI change that triggers a full page reload immediately after a workspace switch is selected from the workspace manager dialog, plus regression coverage.

## Constraints
- Frontend-only change.
- Do not change backend API semantics.
- Keep the existing persisted workspace behavior intact so the refreshed page boots into the selected workspace.
- Scope is limited to the existing workspace switch action in the workspace manager dialog.

## Acceptance Criteria
1. Clicking the switch action for a non-current workspace updates the current workspace state.
2. The dialog closes and the page reloads automatically without requiring manual refresh.
3. After reload, the selected workspace remains the active workspace via persisted settings.
4. Existing workspace management behavior is unchanged for create/delete/restore flows.
5. Frontend tests cover the reload behavior.

## Product Acceptance Criteria
- The user sees the application come back in the selected workspace context after switching.
- No extra confirmation step is introduced.

## Manual Spot Checks
- Open workspace manager, switch from workspace A to B, confirm page reloads.
- After reload, verify header/workspace label reflects B.
- Reopen the workspace manager and verify B is marked current.

## Completion Language Policy
Do not claim completion unless the code change is made and the targeted frontend tests pass.

## Delivery Truth Contract
Implementation truth is the code diff plus test evidence, not intent.

## Non-goals
- No soft refresh orchestration across individual pages.
- No backend workspace switching changes.
- No redesign of workspace switcher UX.

## Autonomy Mode
interactive_governed

## Inferred Assumptions
- A full reload is acceptable UX for this task.
- Persisted Zustand settings already retain the selected workspace across reloads.
