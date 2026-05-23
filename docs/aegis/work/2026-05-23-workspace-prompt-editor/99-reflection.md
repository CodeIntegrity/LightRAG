# Reflection

## Outcome

实现了 workspace-aware 的实体抽取提示词文件编辑入口：后端新增 `/prompts/entity-type` API，前端新增 Prompts tab/page，文件仍落在 `PROMPT_DIR/entity_type`，active 文件仍通过 `addon_params["entity_type_prompt_file"]` 生效。

## Repair Track

- repaired object: 只能手动放置实体抽取 prompt profile 的操作面。
- action: 新增 workspace 前缀文件命名、列表、读取、校验、保存、启用 API 与 WebUI 页面。
- impact: 用户可以在当前 workspace 下创建、编辑、校验、保存并启用 `<workspace>--<prompt_slug>--v<version>.yml`。
- verification: 后端 route 测试、实体抽取稳定性回归、前端 prompt 测试、guest tab 测试、Vite build 均通过；subagent 审查指出的 active-mode 校验和真实文件名展示问题已修复。

## Retirement Track

- retired object: 旧 Prompt Management 数据库版本库、版本 registry、旧激活逻辑。
- action: 未恢复旧 owner；新增能力只包裹现有 `lightrag.prompt` 文件型机制。
- retained boundary: 手动 `foo.yml` 等 global 文件继续可用，`ENTITY_TYPE_PROMPT_FILE` 与构造参数 `addon_params` 语义保持。
- future trigger: 若要求 Gunicorn 多 worker 立即一致，需要单独引入持久化 active registry 或 runtime eviction / broadcast。

## Residual Risk

- 未做真实浏览器端到端手工流程。
- 多进程 Gunicorn 下 active prompt 只保证当前请求命中的 runtime 更新。
- 并发保存同一 `<prompt_slug>, <version>` 仍可能最后写入者覆盖；当前只保证原子写入文件完整。
