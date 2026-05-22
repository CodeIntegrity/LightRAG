# TodoCheckpointDraft

- 当前 todo：
  - [x] 拉取 `upstream/main`
  - [x] 计算共同祖先与提交差异
  - [x] 统计本地/上游改动热区
  - [x] 在隔离 worktree 中执行真实 merge 演练
  - [x] 提取关键冲突块摘要
  - [x] 输出兼容性结论与吸收建议

- 已完成：
  - `origin/main` vs `upstream/main` 分叉建模
  - `HEAD <- upstream/main` 冲突清单
  - 本地新增能力与上游新增能力归类

- Active Slice：
  - 文档化结论，供后续集成分支执行

- Blocked-on：
  - 无代码阻塞；真正合并要等用户决定是否进入集成执行

- Next：
  - 如进入实施阶段，先按 `docs/aegis/sop/upstream-merge-sop.md` 创建集成分支并重演 merge

# ResumeStateHint

- 当前分析已完成，临时 merge worktree 已清理；如需续作，按 SOP 重新创建隔离 worktree 或集成分支
- 若续作，不要从记忆继续；先重读本目录和分析报告，再决定是否进入代码级冲突解决

# DriftCheckDraft

- 是否仍服务原目标：是
- 是否超出兼容边界：否
- 是否引入新 owner / fallback：否
- 退役轨是否明确：是
- 当前决策：`continue`
