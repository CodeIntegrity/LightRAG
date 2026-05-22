# Evidence

## Code Changes

- Frontend:
  - `lightrag_webui/src/stores/state.ts`
  - `lightrag_webui/vite.config.ts`
  - `lightrag_webui/src/api/lightrag.workspace.test.ts`
- Backend:
  - `lightrag/api/graph_workbench.py`
  - `lightrag/api/routers/document_routes.py`
  - `tests/test_query_raw_route.py`
  - `tests/test_document_rebuild_route.py`
  - `tests/test_workspace_runtime_app_integration.py`

## Verification Commands

- `bun test src/components/retrieval/QuerySettings.test.tsx`
- `bun test src/components/workspace/WorkspaceSwitcher.test.tsx`
- `bun test src/stores/graphWorkbench.test.ts src/components/retrieval/QuerySettings.test.tsx`
- `bun test src/components/workspace/WorkspaceManagerDialog.test.tsx src/components/workspace/WorkspaceSwitcher.test.tsx`
- `bun test src/api/lightrag.workspace.test.ts`
- `bun test src/stores/graphWorkbench.test.ts src/components/retrieval/QuerySettings.test.tsx src/components/workspace/WorkspaceManagerDialog.test.tsx src/components/workspace/WorkspaceSwitcher.test.tsx src/api/lightrag.workspace.test.ts`
- `bun run build`
- `./scripts/test.sh tests/test_graph_workbench.py -q`
- `./scripts/test.sh tests/test_graph_routes.py -q`
- `./scripts/test.sh tests/test_document_additional_routes.py -k rebuild_custom_chunks_graph -q`
- `./scripts/test.sh tests/test_query_raw_route.py tests/test_document_rebuild_route.py tests/test_workspace_runtime_app_integration.py -q`
- `./scripts/test.sh tests/test_graph_workbench.py tests/test_graph_routes.py tests/test_query_raw_route.py tests/test_document_rebuild_route.py tests/test_workspace_runtime_app_integration.py -q`

## Verification Results

- Backend aggregate regression: `60 passed in 2.12s`
- `tests/test_document_additional_routes.py -k rebuild_custom_chunks_graph -q`: `2 passed, 6 deselected`
- Frontend aggregate regression: `37 pass / 0 fail`
- WebUI production build: success (`vite build`)

## Observed Non-Blocking Notes

- Vite still emits chunk-size warnings for large bundles; this pre-existed the current fix and does not block the build.
- `lightrag_webui/.gitignore` includes an unrelated `.ace-tool/` modification in the worktree.
