# Goal

实现前端“Prompts/提示词”页，使用户可以在当前 workspace 下创建、编辑、校验、保存和启用实体抽取自定义提示词文件。新能力必须复用上游文件型 prompt 机制：提示词仍落盘到 `PROMPT_DIR/entity_type`，仍由 `ENTITY_TYPE_PROMPT_FILE` / `addon_params["entity_type_prompt_file"]` 指向单个 `.yml` / `.yaml` 文件，不恢复已退役的本地 Prompt Management 版本库。

# Architecture

- 后端新增 workspace-aware prompt file API，负责把当前请求的 `LIGHTRAG-WORKSPACE` 映射为安全文件名前缀。
- 文件不按 workspace 建目录，统一放在 `PROMPT_DIR/entity_type`。
- 新文件命名协议：`<workspace>--<prompt_slug>--v<version>.yml`。
- 前端只展示逻辑字段：`prompt_slug`、`version`、`active`、`source`、`updated_at`；不让用户手写真实路径。
- 激活提示词时只更新当前 workspace runtime 的 `rag.addon_params["entity_type_prompt_file"]`，让现有缓存刷新机制生效。
- 旧手动文件继续有效：用户仍可把 `foo.yml` 放入 `PROMPT_DIR/entity_type` 并通过环境变量或构造参数使用。

# Tech Stack

- 后端：FastAPI、Pydantic、`lightrag.prompt` 现有 YAML loader / validator。
- 前端：React 19、TypeScript、Bun、Vite、Tailwind、现有 `axiosInstance` 和 workspace header 机制。
- 验证：`./scripts/test.sh`、`ruff check`、`bun test`、`bun run build`。

# Baseline/Authority Refs

- `lightrag/prompt.py`
  - `get_entity_type_prompt_dir()`：解析 `PROMPT_DIR/entity_type`。
  - `resolve_entity_type_prompt_path()`：只接受文件名，禁止目录分隔符，只允许 `.yml` / `.yaml`。
  - `load_entity_extraction_prompt_profile()`：读取并校验 YAML 映射。
  - `resolve_entity_extraction_prompt_profile()`：从 `addon_params["entity_type_prompt_file"]` 合并文件 profile 与默认 profile。
  - `validate_entity_extraction_prompt_profile_for_mode()`：校验 text/json 模式所需 examples。
- `lightrag/lightrag.py`
  - `_set_runtime_addon_params()` / `_refresh_addon_params_cache()`：运行时变更 `addon_params` 后刷新缓存。
- `lightrag/api/lightrag_server.py`
  - `LIGHTRAG-WORKSPACE` Header 解析当前 workspace。
  - `WorkspaceRuntimeProxy` 注入当前 workspace 的 `rag`。
- `lightrag_webui/src/api/lightrag.ts`
  - axios request interceptor 已自动写入 `LIGHTRAG-WORKSPACE`。
- `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`
  - 已退役本地 Prompt Management，不应恢复旧版本库 owner。

# Compatibility Boundary

- 必须保持：
  - 手动放置 `PROMPT_DIR/entity_type/foo.yml` 的旧调用方式。
  - `ENTITY_TYPE_PROMPT_FILE` 环境变量和 `addon_params["entity_type_prompt_file"]` 的语义。
  - `resolve_entity_type_prompt_path()` 的文件名沙箱约束。
  - 当前 workspace 通过 `LIGHTRAG-WORKSPACE` Header 传递。
- 允许新增：
  - workspace-aware 的 prompt 文件命名、列表、读取、保存、激活 API。
  - 前端 Prompts 页和 API client 类型。
- 禁止新增：
  - 任意路径读写。
  - 数据库化 Prompt Management 版本库。
  - 改写全局 `PROMPTS` 字典作为用户编辑入口。
  - 自动迁移或删除用户手写的旧 prompt 文件。

# Verification

- 后端静态检查：
  - `ruff check lightrag tests`
- 后端单测：
  - `./scripts/test.sh tests/test_entity_extraction_stability.py -q`
  - `./scripts/test.sh tests/test_workspace_prompt_routes.py -q`
- 前端单测：
  - `cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx`
- 前端构建：
  - `cd lightrag_webui && bun run build`
- 手工最小验证：
  - 启动 API 与 WebUI。
  - 选择 workspace A，创建 `entity-type` 提示词 v1，保存并启用。
  - 切到 workspace B，确认看不到 workspace A 的 workspace-owned active 状态。
  - 回到 workspace A，确认 active 文件名符合 `<workspace>--<prompt_slug>--v<version>.yml`。
  - 手动放入 `PROMPT_DIR/entity_type/foo.yml`，确认旧方式仍可通过环境变量或后端配置使用。

# Plan Basis

## Facts

- 当前 prompt 文件加载只需要一个合法文件名，不要求目录结构。
- 当前 workspace 名由 `normalize_workspace_identifier()` 约束为字母、数字、下划线。
- WebUI API 调用已经自动携带 `LIGHTRAG-WORKSPACE`。
- `rag.addon_params` 是当前 runtime 内可变配置，变更后会在下一次 `_build_global_config()` 前刷新缓存。
- 已退役的本地 Prompt Management 不能作为新能力基础。

## Assumptions

- 这次只支持实体抽取 prompt profile，即 `entity_types_guidance`、`entity_extraction_examples`、`entity_extraction_json_examples`。
- workspace 暂不支持重命名；如果未来支持，提示词文件重命名迁移是单独任务。
- 版本号采用单调整数 `v1`、`v2`、`v3`，不使用时间戳作为主版本。
- 前端编辑器先使用普通 textarea 或现有表单组件；如果引入 Monaco / CodeMirror，需要单独评估包体和构建影响。

## Unknowns

- 当前项目是否已有统一 settings 页面路由约定，实施时需先确认前端导航结构。
- `PROMPT_DIR` 在容器部署下是否挂载为可写目录，部署文档可能需要补充说明。
- 多进程 Gunicorn 下，同一 workspace 的多个 runtime 是否需要广播 active prompt 变更；首版只保证当前请求命中的 runtime 生效，必要时后续扩展 runtime eviction 或 registry 持久化。

# File Map

## Create

- `lightrag/api/routers/prompt_routes.py`
  - 新增 prompt 文件列表、读取、校验、保存、启用 API。
- `tests/test_workspace_prompt_routes.py`
  - 覆盖命名协议、workspace 隔离、YAML 校验、激活行为、旧文件兼容。
- `lightrag_webui/src/pages/Prompts.tsx`
  - 新增提示词管理页面。
- `lightrag_webui/src/api/lightrag.prompts.test.ts`
  - 覆盖 API client 请求形状和响应归一化。
- `lightrag_webui/src/pages/Prompts.test.tsx`
  - 覆盖页面核心交互。

## Modify

- `lightrag/api/lightrag_server.py`
  - include 新的 prompt router，使用 runtime proxy 和现有 auth。
- `lightrag_webui/src/api/lightrag.ts`
  - 新增 prompt API 类型与函数。
- 前端路由 / 导航文件
  - 添加 Prompts 页面入口。实施前先用 CodeGraph 或定向读文件确认实际文件名。
- `docs/LightRAG-API-Server.md` 与 `docs/LightRAG-API-Server-zh.md`
  - 记录 prompt 文件 API、命名规则和部署可写目录要求。

## Do Not Modify Unless Required

- `lightrag/prompt.py`
  - 默认不改现有加载函数。若需要复用校验 helper，可只新增纯函数，不放宽安全约束。
- `lightrag/operate.py`
  - 不改实体抽取调用链。
- 已退役 Prompt Management 相关旧文件
  - 不恢复。

# Naming Contract

## File Name

```text
<workspace>--<prompt_slug>--v<version>.yml
```

示例：

```text
default--entity-type--v1.yml
finance_team--entity-type--v3.yml
```

## Validation

- `workspace`：使用现有 workspace identifier 规则。
- `prompt_slug`：`^[a-z0-9_]+$`，长度建议 1 到 64。
- `version`：正整数，最小值 1。
- suffix：默认 `.yml`，读取时兼容 `.yaml`。
- 分隔符固定为 `--`。
- API 不接受包含 `/`、`\`、`..`、空白首尾、绝对路径的文件名输入。

## Logical Model

```typescript
type WorkspacePromptFile = {
  file_name: string
  workspace: string
  prompt_slug: string
  version: number
  active: boolean
  source: 'workspace' | 'global'
  updated_at: string | null
  size_bytes: number
}
```

# API Contract Draft

## List

`GET /prompts/entity-type`

Response:

```json
{
  "workspace": "default",
  "active_file": "default--entity-type--v1.yml",
  "files": []
}
```

Rules:

- 只列出当前 workspace 前缀文件和可选 global 文件。
- global 文件指不匹配 workspace 命名协议但仍是合法 `.yml/.yaml` 的旧文件。
- `active` 根据当前 `rag.addon_params["entity_type_prompt_file"]` 判断。

## Read

`GET /prompts/entity-type/{file_name}`

Response:

```json
{
  "file_name": "default--entity-type--v1.yml",
  "content": "entity_types_guidance: ...\n",
  "profile": {},
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

Rules:

- 只能读取当前 workspace 文件或 global 文件。
- 不能读取其他 workspace 前缀文件。

## Validate

`POST /prompts/entity-type/validate`

Request:

```json
{
  "content": "entity_types_guidance: ...\n",
  "use_json": false
}
```

Rules:

- 不落盘。
- 使用与 `load_entity_extraction_prompt_profile()` 等价的 YAML / profile 校验。
- 校验 active mode 所需 examples。

## Save

`PUT /prompts/entity-type/{prompt_slug}/versions/{version}`

Request:

```json
{
  "content": "entity_types_guidance: ...\n",
  "activate": false
}
```

Rules:

- 后端生成真实文件名。
- 写入前校验 YAML。
- 写入采用临时文件 + replace 的原子落盘方式。
- 如果 `activate=true`，保存成功后更新当前 runtime 的 `rag.addon_params["entity_type_prompt_file"]`。

## Activate

`POST /prompts/entity-type/activate`

Request:

```json
{
  "file_name": "default--entity-type--v1.yml"
}
```

Rules:

- 文件必须存在且可被当前 workspace 使用。
- 文件必须通过当前实体抽取模式校验。
- 更新当前 runtime：`rag.addon_params["entity_type_prompt_file"] = file_name`。

# Tasks

## Task 1: 后端命名与文件服务 helper

Files:

- Create `lightrag/api/routers/prompt_routes.py`
- Create `tests/test_workspace_prompt_routes.py`

Why:

- 先把安全边界固定，避免 UI 或 API 直接拼路径。

Impact/Compatibility:

- 不修改 `lightrag/prompt.py` 的沙箱规则。
- 新 helper 只在 API 层生成和解析文件名。

Verification:

- `./scripts/test.sh tests/test_workspace_prompt_routes.py -q`

Steps:

- [ ] Write test：覆盖 `default--entity-type--v1.yml` 解析成功、`other--entity-type--v1.yml` 在 workspace `default` 下不可读、`../x.yml` 拒绝、`.txt` 拒绝。
- [ ] Verify RED：运行 `./scripts/test.sh tests/test_workspace_prompt_routes.py -q`，确认新测试因缺少实现失败。
- [ ] Minimal code：实现命名常量、`parse_workspace_prompt_file_name()`、`build_workspace_prompt_file_name()`、`is_global_prompt_file()`、`resolve_prompt_file_for_workspace()`。
- [ ] Verify GREEN：运行 `./scripts/test.sh tests/test_workspace_prompt_routes.py -q`。
- [ ] Commit：`git add lightrag/api/routers/prompt_routes.py tests/test_workspace_prompt_routes.py && git commit -m "feat(prompts): 新增工作区提示词文件命名基础"`。

## Task 2: 后端 prompt API

Files:

- Modify `lightrag/api/routers/prompt_routes.py`
- Modify `lightrag/api/lightrag_server.py`
- Modify `tests/test_workspace_prompt_routes.py`

Why:

- 提供前端所需的列表、读取、校验、保存、启用能力。

Impact/Compatibility:

- API 使用当前 request runtime，不新增全局状态 owner。
- 保存的新文件仍符合现有 `resolve_entity_type_prompt_path()` 能加载的文件名。

Repair Track:

- 新行为：用户通过 API 保存 workspace 前缀文件，并通过 API 激活到当前 `rag.addon_params`。
- 最小修改：新增 router 并 include，不改实体抽取核心链路。

Retirement Track:

- 旧行为：手动文件方式继续保留。
- 已退役行为：不恢复数据库 Prompt Management 或旧版本激活逻辑。

Verification:

- `./scripts/test.sh tests/test_workspace_prompt_routes.py -q`
- `./scripts/test.sh tests/test_entity_extraction_stability.py -q`

Steps:

- [ ] Write test：覆盖 `GET /prompts/entity-type`、`GET /prompts/entity-type/{file}`、`POST /validate`、`PUT /{prompt_slug}/versions/{version}`、`POST /activate`。
- [ ] Verify RED：运行后端 prompt route 测试，确认路由未实现失败。
- [ ] Minimal code：实现 Pydantic request/response models、router factory、YAML 校验、原子写入、激活逻辑，并在 `lightrag_server.py` include router。
- [ ] Verify GREEN：运行本任务验证命令。
- [ ] Commit：`git add lightrag/api/routers/prompt_routes.py lightrag/api/lightrag_server.py tests/test_workspace_prompt_routes.py && git commit -m "feat(prompts): 增加工作区提示词管理接口"`。

## Task 3: 前端 API client

Files:

- Modify `lightrag_webui/src/api/lightrag.ts`
- Create `lightrag_webui/src/api/lightrag.prompts.test.ts`

Why:

- 给页面提供类型稳定的 prompt API 调用入口，复用现有 axios workspace header。

Impact/Compatibility:

- 不改现有 query/document/workspace API。
- 不新增手动传 workspace 参数，继续依赖 `LIGHTRAG-WORKSPACE` interceptor。

Verification:

- `cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts`

Steps:

- [ ] Write test：mock axios，验证 list/read/validate/save/activate 的 method、path、payload。
- [ ] Verify RED：运行前端 API 测试，确认函数不存在失败。
- [ ] Minimal code：新增 TypeScript types 与 `listEntityTypePrompts()`、`readEntityTypePrompt()`、`validateEntityTypePrompt()`、`saveEntityTypePromptVersion()`、`activateEntityTypePrompt()`。
- [ ] Verify GREEN：运行本任务验证命令。
- [ ] Commit：`git add lightrag_webui/src/api/lightrag.ts lightrag_webui/src/api/lightrag.prompts.test.ts && git commit -m "feat(webui): 新增提示词管理接口客户端"`。

## Task 4: 前端 Prompts 页面与导航

Files:

- Create `lightrag_webui/src/pages/Prompts.tsx`
- Create `lightrag_webui/src/pages/Prompts.test.tsx`
- Modify existing frontend route/navigation files after locating them with CodeGraph.

Why:

- 让用户可以直接在 WebUI 内管理当前 workspace 的提示词文件。

Impact/Compatibility:

- 页面只操作当前 workspace header 对应后端数据。
- 页面不暴露路径输入，只暴露 prompt slug、version、content。

Verification:

- `cd lightrag_webui && bun test src/pages/Prompts.test.tsx`
- `cd lightrag_webui && bun run build`

Steps:

- [ ] Write test：覆盖加载列表、选择文件、校验、保存、启用、workspace 切换后重新加载。
- [ ] Verify RED：运行页面测试，确认页面不存在失败。
- [ ] Minimal code：实现 Prompts 页面，包含文件列表、编辑区、校验结果、保存和启用按钮。
- [ ] Minimal code：把 Prompts 加入现有导航和路由，文案使用 i18next 现有模式。
- [ ] Verify GREEN：运行本任务验证命令。
- [ ] Commit：`git add lightrag_webui/src/pages/Prompts.tsx lightrag_webui/src/pages/Prompts.test.tsx <route-files> && git commit -m "feat(webui): 增加工作区提示词编辑页面"`。

## Task 5: 文档与全量验证

Files:

- Modify `docs/LightRAG-API-Server.md`
- Modify `docs/LightRAG-API-Server-zh.md`
- Modify any deployment docs only if verification proves `PROMPT_DIR` writeability needs explicit setup.

Why:

- 记录 API、命名规则、兼容边界和部署注意事项。

Impact/Compatibility:

- 文档必须明确旧手动文件方式仍可用。
- 文档必须明确前端管理文件的命名协议。

Verification:

- `ruff check lightrag tests`
- `./scripts/test.sh tests/test_workspace_prompt_routes.py -q`
- `./scripts/test.sh tests/test_entity_extraction_stability.py -q`
- `cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx`
- `cd lightrag_webui && bun run build`

Steps:

- [ ] Write docs：补充 API 与文件命名说明。
- [ ] Verify docs：检查是否出现“替代旧方式”这类错误表述。
- [ ] Run full verification：执行本任务验证命令。
- [ ] Fix failures：只修复与本计划相关的失败。
- [ ] Commit：`git add docs/LightRAG-API-Server.md docs/LightRAG-API-Server-zh.md && git commit -m "docs(prompts): 说明工作区提示词文件管理"`。

# Risks

- 多进程 runtime 生效范围：当前 runtime 修改 `addon_params` 后立即生效，但其他进程缓存可能不会同步。首版应在文档和测试中限定为当前 runtime；若产品要求跨进程立即一致，需要引入 workspace registry 持久化 active prompt 或 runtime eviction。
- 文件系统权限：`PROMPT_DIR/entity_type` 在容器内必须可写。部署文档需要说明挂载点。
- 版本冲突：两个用户同时保存同一版本可能覆盖。首版可使用原子写保证文件完整；若需要并发保护，后续增加 `If-Match` 或禁止覆盖已有版本。
- 工作区重命名：文件名前缀不会自动迁移。当前非目标。
- YAML 编辑体验：textarea 可满足首版；高级编辑器不进入首版，避免引入额外依赖风险。

# Retirement

- 保留旧手动文件调用方式。
- 停止把“只能手动放文件”作为唯一入口，新增 WebUI 文件管理入口。
- 不恢复已退役的本地 Prompt Management 数据库、版本 registry 或激活逻辑。
- 如果未来确认所有 prompt 都通过 workspace 命名协议管理，也只能在单独计划中讨论是否隐藏 global 文件；本计划不删除 global fallback。

# Self-Review

- Spec coverage：覆盖前端页面、workspace 绑定、文件命名协议、保存/启用、兼容旧方式。
- Placeholder scan：无 `TBD` / `TODO` 占位。
- Type consistency：API draft 与前端 types 使用同一字段。
- Compatibility：明确不改 `PROMPTS`、不放宽文件名沙箱、不恢复旧 Prompt Management。
- Verification：每个任务都有后端或前端命令。
- Dual-track：包含新行为修复轨与旧方式退役轨。
- ADR signal：存在 durable owner/source-of-truth 决策；完成后如实现落地，应评估是否补 ADR 或 baseline sync。
