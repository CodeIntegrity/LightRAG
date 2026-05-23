# Task Intent

## Requested Outcome

实现当前 workspace 下的实体抽取提示词编辑能力：后端提供 workspace-aware 文件 API，前端提供 Prompts 页面创建、编辑、校验、保存和启用 `.yml/.yaml` prompt profile。

## Scope

- 后端新增 `lightrag/api/routers/prompt_routes.py`。
- 后端在 `lightrag/api/lightrag_server.py` include 新 router。
- 前端在 `lightrag_webui/src/api/lightrag.ts` 增加 prompt API client。
- 前端新增 `lightrag_webui/src/pages/Prompts.tsx` 与路由/导航入口。
- 增加后端与前端测试。

## Non-goals

- 不恢复已退役的本地 Prompt Management 版本库、数据库 owner 或旧激活逻辑。
- 不改变 `lightrag/prompt.py` 的文件名沙箱规则。
- 不新增按 workspace 建目录的 prompt 存储。
- 不实现 Gunicorn 多进程 runtime 广播。

## Success Evidence

- `./scripts/test.sh tests/test_workspace_prompt_routes.py -q`
- `./scripts/test.sh tests/test_entity_extraction_stability.py -q`
- `ruff check lightrag tests`
- `cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx`
- `cd lightrag_webui && bun run build`

## Baseline Read Set

- `docs/aegis/plans/2026-05-23-workspace-prompt-editor.md`
- `docs/aegis/baseline/2026-05-08-initial-baseline.md`
- `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`
- `lightrag/prompt.py`
- `lightrag/lightrag.py`
- `lightrag/api/lightrag_server.py`
- `lightrag_webui/src/api/lightrag.ts`

## Impact Statement

新行为通过 API 生成 `<workspace>--<prompt_slug>--v<version>.yml` 文件并激活当前 runtime 的 `addon_params["entity_type_prompt_file"]`。旧手动文件仍通过 `ENTITY_TYPE_PROMPT_FILE` 或构造参数使用；旧 Prompt Management owner 继续保持退役。
