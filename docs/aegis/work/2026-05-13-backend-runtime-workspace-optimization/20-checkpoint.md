# Todo Checkpoint Draft

- 当前 todo：
  - [x] 建立隔离 worktree
  - [x] 读取计划与基线
  - [x] 校正当前仓库中的测试文件落点
  - [x] Task 1：补 workspace registry 异常映射失败测试并修复
  - [x] Task 2：补严格 header 校验测试并修复
  - [x] Task 3：补 cache-first 快路径测试并修复
  - [x] Task 4：补文档并跑回归
- 已完成：
  - 在 `.worktrees/backend-runtime-workspace-opt` 建立隔离分支 `feat/backend-runtime-workspace-opt`
  - 确认 `tests/test_workspace_registry_store.py`、`tests/test_workspace_runtime_manager.py`、`tests/test_workspace_runtime_app_integration.py` 是本次主要验证入口
- Active Slice：完成，等待人工审阅/提交
- Blocked On：无
- Next Step：如需继续，进入 code review / commit / PR 描述整理

## Resume State Hint

- 先看本文件，再看 `10-intent.md`，然后继续 Task 1。
- 若测试文件落点再变化，以仓库现状为准，但不要扩大到无关路由。

## Drift Check Draft

- 原始意图是否仍成立：是
- 是否仍在兼容边界内：是
- 是否出现新 owner / fallback / adapter：否
- 退役轨道是否仍明确：是
- 当前决策：`ready_for_review`
