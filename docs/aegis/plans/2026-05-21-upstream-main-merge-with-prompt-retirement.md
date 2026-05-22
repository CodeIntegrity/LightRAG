# Goal

在隔离集成分支中把 `upstream/main` 合入当前仓库，同时**彻底退役本地二开 Prompt Management 前端、后端路由与版本库能力**，回归到上游当前的提示词机制：`lightrag/prompt.py` 的 profile 解析 + `prompts/` 目录中的文件型定制。

# Architecture

这次不是单一 merge，也不是单一功能删除，而是一次双轨执行：

1. **Repair Track**：把 `upstream/main` 的 parser / pipeline / prompt profile / role config 等平台能力合进来
2. **Retirement Track**：删除本地 Prompt Management UI、版本管理路由、版本存储与 API 契约扩展

核心分区：

1. 集成与基线区：Git 分支、merge 演练、回滚锚点
2. Prompt owner 退役区：`prompt_config_routes`、`prompt_version_store`、`prompt_versions`
3. Query 契约收口区：`prompt_overrides`、health/config 字段、前端 API types
4. WebUI 退役区：`PromptManagement` 页面、tab、selector、draft/override 状态
5. Upstream prompt 回归区：`lightrag/prompt.py`、`prompts/UserCustomizePrompts.md`
6. 验证与文档区：pytest、bun build/test、OpenAPI、support matrix、迁移说明

# Tech Stack

- Git / worktree
- Python / FastAPI / Pydantic / pytest / ruff / uv
- Bun / React / TypeScript / Zustand
- LightRAG upstream prompt profile 机制

# Baseline/Authority Refs

- [docs/analysis/2026-05-21-upstream-main-compatibility-report.md](/root/project/LightRAG/docs/analysis/2026-05-21-upstream-main-compatibility-report.md:1)
- [docs/aegis/sop/upstream-merge-sop.md](/root/project/LightRAG/docs/aegis/sop/upstream-merge-sop.md:1)
- [docs/aegis/plans/2026-05-08-upstream-main-merge.md](/root/project/LightRAG/docs/aegis/plans/2026-05-08-upstream-main-merge.md:1)
- 当前本地 prompt 入口：
  - [lightrag/api/routers/prompt_config_routes.py](/root/project/LightRAG/lightrag/api/routers/prompt_config_routes.py:1)
  - [lightrag/prompt_version_store.py](/root/project/LightRAG/lightrag/prompt_version_store.py:1)
  - [lightrag/prompt_versions.py](/root/project/LightRAG/lightrag/prompt_versions.py:1)
  - [lightrag_webui/src/features/PromptManagement.tsx](/root/project/LightRAG/lightrag_webui/src/features/PromptManagement.tsx:1)
- upstream 实际 prompt 入口：
  - `upstream/main:lightrag/prompt.py`
  - `upstream/main:prompts/UserCustomizePrompts.md`
  - `upstream/main:prompts/samples/entity_type_prompt.sample.yml`

# Compatibility Boundary

必须保持：

- workspace 生命周期、guest 能力、graph workbench、文档管理、存储兼容修复不退化
- 上游 parser / pipeline / chunker / sidecar / role config 能力可进入主线
- WebUI 仍可完成 documents / knowledge graph / retrieval / api 的主路径

明确收缩：

- 删除 Prompt Management tab、页面、组件、路由、版本库、版本切换器、inline save/import/export
- 删除 `prompt_overrides`、`allow_prompt_overrides_via_api`、`active_prompt_versions` 这组本地扩展契约
- 删除 prompt 版本相关测试、文档和 OpenAPI 描述

回归上游：

- Prompt 定制只通过上游 `prompt.py` + `prompts/` 文件型机制承载
- retrieval 侧仅保留 upstream 仍支持的 query 参数；`user_prompt` 是否保留以 upstream 真实契约为准

# Verification

- `git status --short --branch`
- `git merge --no-commit --no-ff upstream/main`
- `ruff check lightrag/ tests/`
- `python -m pytest tests/test_extract_entities.py tests/test_keyword_prompt_template.py -q`
- `python -m pytest tests/test_query_raw_route.py tests/test_workspace_runtime_app_integration.py tests/test_document_rebuild_route.py -q`
- `python -m pytest tests/ -q`
- `cd lightrag_webui && bun install --frozen-lockfile`
- `cd lightrag_webui && bun run build`
- `cd lightrag_webui && bun test`

# Plan Basis

## Facts

- `upstream/main` 当前不包含本地这套 Prompt Management WebUI / API / 版本库实现。
- 我直接检查 `upstream/main` 树后，实际存在的是：
  - `lightrag/prompt.py`
  - `lightrag/prompt_multimodal.py`
  - `prompts/UserCustomizePrompts.md`
  - `prompts/samples/entity_type_prompt.sample.yml`
- `upstream/main` 不包含这些本地符号或文件：
  - `prompt_config_routes`
  - `PromptVersionStore`
  - `allow_prompt_overrides_via_api`
  - `active_prompt_versions`
  - `PromptManagement.tsx`

## Assumptions

- 用户接受“删除本地版本化提示词管理能力后，不再提供等价 WebUI 替代”，而是回归上游文件/配置型定制方式。
- 若外部客户端依赖 `prompt_overrides` 或 `/health` 中的 `active_prompt_versions`，允许同步做 breaking change，并补迁移说明。

## Unknowns

- 现网是否已有 Dify 或其他调用方依赖 `prompt_overrides`
- 是否有未纳入仓库测试的运维脚本依赖 Prompt Management 相关接口

# Ripple Signal Triage

- **Owner change**：prompt owner 从“本地版本库 + WebUI + API”收缩为“upstream prompt/profile 文件”
- **Contract change**：`/health`、`/query`、前端 API types、OpenAPI、support matrix 都受影响
- **Downstream impact**：Retrieval UI、guest visible tabs、workspace stats、Dify OpenAPI、测试基线
- **Verification expansion**：不能只跑 prompt tests；还要跑 retrieval、workspace runtime、document rebuild、full build

# File Map

## 删除候选

- `lightrag/api/routers/prompt_config_routes.py`
- `lightrag/prompt_version_store.py`
- `lightrag/prompt_versions.py`
- `lightrag_webui/src/features/PromptManagement.tsx`
- `lightrag_webui/src/features/PromptManagement.test.tsx`
- `lightrag_webui/src/components/prompt-management/*`
- `lightrag_webui/src/components/retrieval/PromptOverridesEditor.tsx`
- `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.tsx`
- `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.test.ts`
- `lightrag_webui/src/utils/promptVersioning.ts`
- `lightrag_webui/src/utils/promptVersioning.test.ts`
- `lightrag_webui/src/utils/promptOverrides.test.ts`
- 版本化/覆盖相关后端与前端测试文件

## 必改

- `lightrag/api/lightrag_server.py`
- `lightrag/api/config.py`
- `lightrag/api/routers/query_routes.py`
- `lightrag/lightrag.py`
- `lightrag/operate.py`
- `lightrag/prompt.py`
- `lightrag/base.py`
- `lightrag_webui/src/App.tsx`
- `lightrag_webui/src/features/SiteHeader.tsx`
- `lightrag_webui/src/features/RetrievalTesting.tsx`
- `lightrag_webui/src/components/retrieval/QuerySettings.tsx`
- `lightrag_webui/src/stores/settings.ts`
- `lightrag_webui/src/stores/state.ts`
- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/lib/guestFeatures.ts`
- `docs/api-support-matrix.md`
- `docs/integrations/dify-query-tool.md`
- `docs/integrations/dify-query-tool.openapi.json`

## 需重点复核但未必改

- `tests/test_extract_entities.py`
- `tests/test_query_raw_route.py`
- `tests/test_workspace_runtime_app_integration.py`
- `tests/test_document_rebuild_route.py`
- `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`

# Task 1 - 建立集成分支并确认 prompt 退役基线

Files:

- 无源码修改
- 参考：
  - [docs/analysis/2026-05-21-upstream-main-compatibility-report.md](/root/project/LightRAG/docs/analysis/2026-05-21-upstream-main-compatibility-report.md:1)
  - `upstream/main:lightrag/prompt.py`

Why:

- 先把“上游没有 Prompt Management UI/API”这个事实钉死，避免后续误以为有等价替代

Impact/Compatibility:

- 不改代码，只建立执行面和判断面

Verification:

- `git status --short --branch`
- `git switch -c integrate/2026-05-21-upstream-main-prompt-retire`
- `git merge --no-commit --no-ff upstream/main || true`
- `git diff --name-only --diff-filter=U`

- [ ] 记录当前基线与未提交变更：`git status --short --branch`
- [ ] 创建集成分支：`git switch -c integrate/2026-05-21-upstream-main-prompt-retire`
- [ ] 重演受控 merge：`git merge --no-commit --no-ff upstream/main || true`
- [ ] 导出冲突清单并单独标记 prompt 相关冲突：`git diff --name-only --diff-filter=U`
- [ ] 当前不提交，进入 prompt owner 退役任务

# Task 2 - 先退役后端 Prompt Management owner

Files:

- 删除：
  - `lightrag/api/routers/prompt_config_routes.py`
  - `lightrag/prompt_version_store.py`
  - `lightrag/prompt_versions.py`
- 修改：
  - `lightrag/api/lightrag_server.py`
  - `lightrag/api/config.py`
  - `lightrag/lightrag.py`
  - `lightrag/operate.py`
  - `lightrag/prompt.py`

Why:

- 先删 owner，再做 merge，能显著缩小冲突面；否则会一直在“本地版本库 vs upstream prompt profile”两套机制间摇摆

Impact/Compatibility:

- 明确 breaking change：Prompt version registry、Prompt activation、Prompt diff、Prompt rebuild-from-version 全部下线

Repair Track:

- 把上游 `prompt.py` / prompt profile / file-based customization 作为唯一主线

Retirement Track:

- 删除本地版本库与版本路由，不再保留 compat-only carrier

Verification:

- `ruff check lightrag/ tests/`
- `python -m pytest tests/test_extract_entities.py tests/test_keyword_prompt_template.py -q`

- [ ] 删除 prompt version 路由与版本库文件，只保留 upstream prompt/profile 机制
- [ ] 从 `lightrag/api/lightrag_server.py` 删除 `create_prompt_config_routes`、`PromptVersionStore` 及相关 health/config 暴露
- [ ] 从 `lightrag/lightrag.py`、`lightrag/operate.py` 中移除对本地 prompt 版本激活/覆盖链路的依赖，改接 upstream prompt/profile 解析
- [ ] 跑 `ruff check lightrag/ tests/`，确保 import 和类型面先收干净
- [ ] 跑 `python -m pytest tests/test_extract_entities.py tests/test_keyword_prompt_template.py -q`

# Task 3 - 收口 `/query` 与 `/health` 契约到 upstream prompt 机制

Files:

- `lightrag/api/routers/query_routes.py`
- `lightrag/base.py`
- `lightrag/api/config.py`
- `lightrag/api/lightrag_server.py`
- `docs/integrations/dify-query-tool.md`
- `docs/integrations/dify-query-tool.openapi.json`
- `docs/api-support-matrix.md`

Why:

- Prompt Management 的后端 owner 删掉之后，API 契约也必须一起收口；否则前端和外部工具仍会请求不存在的能力

Impact/Compatibility:

- `/query` 中本地 `prompt_overrides` 扩展应下线
- `/health` 中 `allow_prompt_overrides_via_api` / `active_prompt_versions` 应下线
- Dify schema 必须同步删掉 `prompt_overrides`

Repair Track:

- 对齐 upstream query schema

Retirement Track:

- 删除本地扩展字段与能力开关

Verification:

- `python -m pytest tests/test_query_raw_route.py tests/test_workspace_runtime_app_integration.py tests/test_document_rebuild_route.py -q`

- [ ] 从 `QueryRequest` / `QueryParam` / query routes 中删除 `prompt_overrides` 解析、验证与 capability gating
- [ ] 从 `/health` 响应和前端依赖字段中删除 `allow_prompt_overrides_via_api`、`active_prompt_versions`
- [ ] 更新 Dify OpenAPI 和文档，确保不再暴露 `prompt_overrides`
- [ ] 跑 `python -m pytest tests/test_query_raw_route.py tests/test_workspace_runtime_app_integration.py tests/test_document_rebuild_route.py -q`
- [ ] 提交：`git commit -m "refactor(prompt): retire local prompt management backend contract"`

# Task 4 - 删除 WebUI Prompt Management tab 与 retrieval 侧版本化/覆盖 UI

Files:

- 删除：
  - `lightrag_webui/src/features/PromptManagement.tsx`
  - `lightrag_webui/src/features/PromptManagement.test.tsx`
  - `lightrag_webui/src/components/prompt-management/*`
  - `lightrag_webui/src/components/retrieval/PromptOverridesEditor.tsx`
  - `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.tsx`
  - `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.test.ts`
  - `lightrag_webui/src/utils/promptVersioning.ts`
  - `lightrag_webui/src/utils/promptVersioning.test.ts`
- 修改：
  - `lightrag_webui/src/App.tsx`
  - `lightrag_webui/src/features/SiteHeader.tsx`
  - `lightrag_webui/src/features/RetrievalTesting.tsx`
  - `lightrag_webui/src/components/retrieval/QuerySettings.tsx`
  - `lightrag_webui/src/stores/settings.ts`
  - `lightrag_webui/src/stores/state.ts`
  - `lightrag_webui/src/api/lightrag.ts`
  - `lightrag_webui/src/lib/guestFeatures.ts`
  - `lightrag_webui/src/locales/*.json`

Why:

- 当前 WebUI 对 prompt 管理的耦合不止一个页面，还包括 tab、query settings、health state、guest 可见 tab 和多语言文案

Impact/Compatibility:

- Prompt Management tab 消失
- Retrieval 页面不再提供 prompt version 选择、draft、save-as-version、request override 编辑
- 仍保留 upstream 支持的基础 query 交互

Repair Track:

- 对齐 upstream WebUI 信息架构

Retirement Track:

- 删除本地 Prompt Management UI owner 与所有残余状态

Verification:

- `cd lightrag_webui && bun test`
- `cd lightrag_webui && bun run build`

- [ ] 从 `App.tsx`、`SiteHeader.tsx`、guest feature 配置中删除 `prompt-management` tab
- [ ] 从 `settings.ts`、`state.ts`、`api/lightrag.ts` 中删除 prompt version / override 相关状态与类型
- [ ] 从 retrieval 页面删除 version selector、override editor，保留 upstream 仍支持的 query 输入项
- [ ] 更新所有 locale 文案，删除 prompt management 与 prompt override 专属翻译键
- [ ] 跑 `cd lightrag_webui && bun run build && bun test`

# Task 5 - 解决剩余 merge 冲突并重建锁文件

Files:

- `lightrag/api/lightrag_server.py`
- `lightrag/lightrag.py`
- `lightrag/operate.py`
- `lightrag/prompt.py`
- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/stores/state.ts`
- `lightrag_webui/package.json`
- `lightrag_webui/bun.lock`
- `pyproject.toml`
- `uv.lock`

Why:

- prompt 退役后，冲突面会明显收缩；此时再解核心文件冲突，成本最低

Impact/Compatibility:

- 需要同时吸收上游 parser/pipeline/prompt profile，又不能打坏本地 workspace/graph

Repair Track:

- 共享入口文件采用“本地 workspace/graph + upstream prompt/pipeline”拼接策略

Retirement Track:

- 对 prompt 相关冲突优先取 upstream 或直接删除本地分支内容

Verification:

- `uv sync --extra api --extra test --extra offline-storage --extra offline-llm`
- `python -m pytest tests/ -q`
- `cd lightrag_webui && bun install --frozen-lockfile`
- `cd lightrag_webui && bun run build && bun test`

- [ ] 解决 `lightrag_server.py` / `lightrag.py` / `operate.py` / `prompt.py` 冲突时，明确禁止把本地 prompt owner 重新拼回去
- [ ] 先定 `pyproject.toml` 和 `package.json`，再重建 `uv.lock` 与 `bun.lock`，不逐块手工合锁文件
- [ ] 跑 `uv sync --extra api --extra test --extra offline-storage --extra offline-llm`
- [ ] 跑 `python -m pytest tests/ -q`
- [ ] 跑 `cd lightrag_webui && bun install --frozen-lockfile && bun run build && bun test`

# Task 6 - 文档、迁移说明与合并收尾

Files:

- `docs/api-support-matrix.md`
- `docs/integrations/dify-query-tool.md`
- `docs/integrations/dify-query-tool.openapi.json`
- `docs/aegis/baseline/2026-05-08-initial-baseline.md`
- 本计划文件

Why:

- 这次不只是内部实现变更，还收缩了对外能力；必须留下迁移说明

Impact/Compatibility:

- prompt management 相关接口删除后，旧客户端和旧文档都会误导使用者

Verification:

- `git diff --check`
- `git status --short`

- [ ] 在 support matrix 中移除 Prompt Management 路由与 health/query 扩展能力
- [ ] 在 Dify 文档中删除 `prompt_overrides` 说明，并说明 prompt 定制改走 `prompts/` 文件
- [ ] 在 baseline 中追加本次“退役本地 prompt owner，回归 upstream file-based prompt”的变更条目
- [ ] 跑 `git diff --check`
- [ ] 最终提交：`git commit -m "merge(upstream): retire local prompt management and align with upstream prompt flow"`

# Risks

- **Breaking API risk**：如果外部客户端在用 `prompt_overrides`，这次会直接失效
- **UX shrink risk**：删除 Prompt Management 后，用户不再能在 WebUI 中做提示词版本管理
- **False upstream parity risk**：上游没有等价 UI/API；若团队预期“删完还有同等前端能力”，这次计划不满足
- **Merge camouflage risk**：`scripts/setup/setup.sh`、`lightrag/kg/*` 这类自动合上的文件仍可能有语义回归

# Rollback Surface

- 只在 `integrate/2026-05-21-upstream-main-prompt-retire` 上执行
- 合并前打 tag：`git tag aegis/2026-05-21-pre-upstream-prompt-retire`
- 每完成一块 owner 退役或冲突解决就单独提交
- 若 prompt owner 删除后发现外部依赖过强，可只回退退役提交，不回退整个 upstream merge

# Retirement

## Delete

- Prompt Management 页面、组件、tab、版本 selector、draft/override editor
- prompt version store / prompt version models / prompt config routes
- `prompt_overrides`、`allow_prompt_overrides_via_api`、`active_prompt_versions`

## Keep

- upstream `lightrag/prompt.py`
- upstream `prompts/` 文件型定制目录
- upstream prompt profile / entity type prompt file 机制
- 若 upstream query 仍保留 `user_prompt`，则保留该简单输入能力

## Deletion Trigger

- 本计划批准即为删除触发条件，不再等待“等价 UI 替代”

# Self-Review

- 已明确问题、基线、文件 owner、兼容边界、验证门槛、风险与回滚面
- 已把本地 prompt owner 的退役轨和 upstream merge 的修复轨放在同一个计划中
- 已记录关键事实：上游没有等价 Prompt Management UI/API，只有文件型 prompt/profile 机制
- 仍需在执行前由使用方确认：是否接受这次 API/UX 收缩是有意 breaking change
