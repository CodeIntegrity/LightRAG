# Intent

- Requested outcome:
  - 在隔离 worktree 中执行上游大版本合并后二开冲突审计，产出模块级风险矩阵、定向验证切面和后续处理顺序。
- Scope:
  - 当前集成分支 `integrate/2026-05-22-upstream-main-prompt-retire`
  - authority upstream `upstream/main`
  - merge base `b62c2606`
  - merge commit `3d9e5df2`
- Non-goals:
  - 本轮不直接修源码
  - 本轮不回流已退役的 Prompt Management owner
  - 本轮不修改主工作区中的未提交变更

# Baseline Read Set Hint

- `task_plan.md`
- `findings.md`
- `progress.md`
- `docs/aegis/plans/2026-05-22-post-merge-custom-conflict-audit.md`
- `docs/analysis/2026-05-21-upstream-main-compatibility-report.md`
- `docs/aegis/sop/upstream-merge-sop.md`

# Impact Statement Draft

- 审计结论会直接影响后续 merge 修复顺序、保留 owner 判断、测试范围和退役边界。
- 若判断错误，可能导致本地 workspace/graph/custom-chunks 能力被上游平台化改动静默覆盖。
