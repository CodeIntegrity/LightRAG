# Evidence Bundle Draft

## Evidence Log

- 已读取计划文件并建立索引。
- 已读取 Aegis index、initial baseline、prompt retirement plan。
- 已通过本地代码检索定位 prompt profile、workspace header、前端导航相关 owner。
- 后端 RED：`./scripts/test.sh tests/test_workspace_prompt_routes.py -q` 失败，证据为 `prompt_routes` 缺失；测试环境阻塞通过 `uv sync --extra test` 解除。
- 后端 GREEN：`./scripts/test.sh tests/test_workspace_prompt_routes.py -q` -> 3 passed。
- 后端回归：`./scripts/test.sh tests/test_entity_extraction_stability.py -q` -> 41 passed。
- 前端 API RED：`bun test src/api/lightrag.prompts.test.ts` 失败，证据为测试 hook / prompt API 函数缺失。
- 前端页面 RED：`bun test src/pages/Prompts.test.tsx` 失败，证据为 `./Prompts` 缺失。
- 前端 GREEN：`cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx` -> 6 pass, 0 fail。
- 前端 guest tab 回归：`cd lightrag_webui && bun test src/lib/guestFeatures.test.ts` -> 4 pass, 0 fail。
- 后端静态检查：`uv run ruff check lightrag tests` -> All checks passed。
- 前端构建：`cd lightrag_webui && bun run build` -> built in 939ms；警告为 Vite 大 chunk 和 `vite:react-swc` esbuild option deprecation。
- 最终后端重跑：`uv run ruff check lightrag tests && ./scripts/test.sh tests/test_workspace_prompt_routes.py -q` -> All checks passed；3 passed in 0.69s。
- 只读审查：subagent 找到 3 个缺口，分别是前端 Validate 固定 text 模式、UI 展示真实文件名、测试未覆盖；已通过 `Prompts.tsx` 与 `Prompts.test.tsx` 修复。
- 审查修复后重跑：`cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx` -> 6 pass, 0 fail。
- 审查修复后构建：`cd lightrag_webui && bun run build` -> built in 853ms；警告仍为 Vite 大 chunk 和 `vite:react-swc` esbuild option deprecation。
- 审查修复后回归：`uv run ruff check lightrag tests` -> All checks passed；`./scripts/test.sh tests/test_workspace_prompt_routes.py -q` -> 3 passed；`./scripts/test.sh tests/test_entity_extraction_stability.py -q` -> 41 passed；`cd lightrag_webui && bun test src/lib/guestFeatures.test.ts` -> 4 pass。

## Coverage

- 后端覆盖：命名 helper、workspace 隔离、unsafe 文件名拒绝、global 文件兼容、列表、读取、校验、保存、启用、server runtime binding、实体抽取 profile 回归。
- 前端覆盖：API method/path/payload、path encode、页面状态 helper、加载、选择、校验、保存、启用、workspace 切换重载、页面 shell 渲染、逻辑字段展示、不手传 `use_json` 的 active-mode 校验、guest visible tab fallback。
- 构建覆盖：Vite production bundle 能生成 Prompts chunk。

## Not Covered

- 未启动真实 API Server + 浏览器做端到端手工点击。
- 未验证 Gunicorn 多 worker 间 active prompt 立即同步；当前设计只更新处理请求的 runtime。
- 未验证生产容器中的 `PROMPT_DIR/entity_type` 挂载写权限，只在文档中记录要求。
