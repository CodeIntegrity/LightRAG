# Todo Checkpoint

## Current Todo

- [x] 建立计划与基线读集
- [x] 后端 helper 与 route TDD
- [x] 前端 API client TDD
- [x] 前端 Prompts 页面与导航 TDD
- [x] 文档与 dev proxy 补齐
- [x] 全量验证、审查与收尾

## Active Slice

完成态复核。

## Evidence Refs

- 计划文件：`docs/aegis/plans/2026-05-23-workspace-prompt-editor.md`
- 基线：`docs/aegis/baseline/2026-05-08-initial-baseline.md`
- 退役基线：`docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`
- 后端 RED：`./scripts/test.sh tests/test_workspace_prompt_routes.py -q` 先失败，缺少 `prompt_routes`。
- 后端 GREEN：`./scripts/test.sh tests/test_workspace_prompt_routes.py -q` -> 3 passed。
- 后端回归：`./scripts/test.sh tests/test_entity_extraction_stability.py -q` -> 41 passed。
- 前端 API RED：`bun test src/api/lightrag.prompts.test.ts` 先失败，缺少 prompt API test hooks / client functions。
- 前端页面 RED：`bun test src/pages/Prompts.test.tsx` 先失败，缺少 `Prompts` 页面。
- 前端 GREEN：`cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx` -> 6 pass。
- 访客 tab 回归：`cd lightrag_webui && bun test src/lib/guestFeatures.test.ts` -> 4 pass。
- 后端静态检查：`uv run ruff check lightrag tests` -> All checks passed。
- 前端构建：`cd lightrag_webui && bun run build` -> built successfully；保留 Vite 大 chunk 与 SWC esbuild deprecation warning。
- 只读审查：subagent 指出 Validate 固定 text 模式、UI 展示真实文件名、测试固化缺口；已修复。
- 最终重跑：`uv run ruff check lightrag tests` -> All checks passed；`./scripts/test.sh tests/test_workspace_prompt_routes.py -q` -> 3 passed；`./scripts/test.sh tests/test_entity_extraction_stability.py -q` -> 41 passed；`bun test src/lib/guestFeatures.test.ts` -> 4 pass。

## Blockers

暂无。

## Next Step

等待用户后续决定是否提交、PR 或继续扩展多进程激活一致性。

## Drift Check

- Intent: aligned
- Compatibility boundary: 手动文件与 `entity_type_prompt_file` 语义保留
- New owner/fallback/adapter: 新增 `lightrag/api/routers/prompt_routes.py` 文件型 API owner；未新增旧 Prompt Management fallback
- Retirement track: 旧 Prompt Management 版本库、数据库 owner、旧激活逻辑未恢复；global 手动文件兼容保留
- Review closure: Validate 由后端 current runtime 模式决定；UI 展示逻辑字段，不直接展示真实文件名
- Decision: complete after final handoff
