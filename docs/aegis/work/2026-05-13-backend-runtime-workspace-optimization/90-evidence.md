# Evidence Bundle Draft

- `git worktree add .worktrees/backend-runtime-workspace-opt -b feat/backend-runtime-workspace-opt`
- `mcp__ace_tool__.search_context`: 已定位 `workspace_runtime_binding()`、`get_workspace_from_request()`、`WorkspaceRuntimeManager.acquire_runtime()` 与现有测试文件
- `mcp__context_mode__.ctx_batch_execute`: 已确认计划中文件名与仓库现状有偏差，当前测试入口为：
  - `tests/test_workspace_runtime_app_integration.py`
  - `tests/test_workspace_registry_store.py`
  - `tests/test_workspace_runtime_manager.py`
- Task 1：
  - 失败前：`uv run --extra test python -m pytest tests/test_workspace_runtime_app_integration.py -k 'unregistered_workspace or registry_internal_error' -q` -> `1 failed, 1 passed`
  - 修复后：同命令 -> `2 passed`
- Task 2：
  - 夹具修正后失败前：`uv run --extra test python -m pytest tests/test_workspace_runtime_app_integration.py -k 'invalid_workspace_header or default_workspace_without_header or resolve_runtime_from_workspace_header' -q` -> `1 failed, 3 passed`
  - 修复后：同命令 -> `4 passed`
- Task 3：
  - 失败前：`uv run --extra test python -m pytest tests/test_workspace_runtime_manager.py tests/test_workspace_runtime_app_integration.py -k 'acquire_cached_runtime or cached_runtime_allows_query_when_registry_temporarily_fails' -q` -> `2 failed`
  - 修复后：同命令 -> `2 passed`
- Final Regression：
  - `uv run --extra test python -m pytest tests/test_workspace_runtime_app_integration.py tests/test_workspace_runtime_manager.py tests/test_workspace_registry_store.py -q` -> `25 passed`
