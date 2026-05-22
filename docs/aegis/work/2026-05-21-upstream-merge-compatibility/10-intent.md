# TaskIntentDraft

- 目标：拉取 `upstream/main`，评估其与当前二次开发主线的兼容性、可合并性、冲突面与吸收价值。
- 范围：`origin/main` 与 `upstream/main` 的分叉点、改动热区、真实 merge 冲突、核心共享入口、WebUI 契约、锁文件与验证门槛。
- 非目标：本轮不直接解决冲突、不直接修改业务代码、不把结果合入 `main`。

# BaselineReadSetHint

- `AGENTS.md`
- `docs/aegis/plans/2026-05-08-upstream-main-merge.md`
- `docs/aegis/sop/upstream-merge-sop.md`

# ImpactStatementDraft

- 这是平台升级兼容性分析，不是普通功能开发。
- 风险集中在 `lightrag/` 核心编排、`document_routes`、Prompt 体系、WebUI 文档管理与锁文件重建。
