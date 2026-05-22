# 2026-05-21 upstream/main 兼容性分析

## 1. 结论

### 事实

- 已成功拉取 `upstream/main`，当前上游头提交为 `b62c2606`（2026-05-21 15:34:35 +0800，`Merge branch 'dev'`）。
- 当前本地分析基线为 `HEAD=b8748374`，`origin/main=7b6170f3`，共同祖先为 `5d738ae9`（2026-05-12 11:21:12 +0800）。
- `origin/main` 相对共同祖先领先 `194` 个提交；`upstream/main` 相对共同祖先领先 `649` 个提交。
- 双方改动文件重叠 `47` 个；在隔离 worktree 中执行 `git merge --no-commit --no-ff upstream/main` 后，得到真实内容冲突文件 `16` 个。
- 上游新增文件 `141` 个，核心增量集中在 `lightrag/chunker/`、`lightrag/external_parser/`、`lightrag/native_parser/docx/`、`lightrag/pipeline.py`、`lightrag/parser_*`、`lightrag/sidecar/` 及其测试。
- 本地新增文件 `190` 个，核心二开集中在 workspace 生命周期、图谱工作台、Prompt 版本管理、Nebula 适配、部署与交付文档。

### 推论

- 这不是“可直接拉平”的小步同步，而是一次需要集成分支承接的结构化合并。
- 技术上可以合并，但不适合直接在 `main` 上执行；必须在隔离分支上分层解决冲突并跑完整回归。
- 上游新增能力值得吸收，尤其是文件处理管线、解析器、分块器、多模态和角色化 LLM 配置；但本地 workspace、graph workbench、Prompt 版本化、Nebula 与部署适配不能被覆盖。

### 附加约束

- 依据 `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`，**本地 Prompt Management（WebUI + API + 版本库）将在合并中显式退役**，回归上游 `lightrag/prompt.py` + `prompts/` 文件型定制机制。
- 该退役决策使冲突面显著收缩：`prompt.py`、`operate.py`、`lightrag.py`、`lightrag_server.py` 中与 Prompt 版本化相关的本地改动全部以取上游方式解决，冲突面预估收缩约 30%。

### 建议

- **可以合并，但只能做"分层吸收 + 人工拼接"，不建议直接整仓硬合。**
- **建议以 Prompt 退役为前置步骤，先删后合，减少同时操作的冲突维度。**
- **建议保留本地产品化能力（workspace/graph/Nebula/deployment），吸收上游平台化能力（pipeline/parser/chunker/role_llm/sidecar）。**

## 2. 基线快照

```text
HEAD           b8748374  2026-05-21 17:11:34 +0800  dify工具定制
origin/main    7b6170f3
upstream/main  b62c2606  2026-05-21 15:34:35 +0800  Merge branch 'dev'
merge-base     5d738ae9  2026-05-12 11:21:12 +0800  Merge pull request #3058 from viraj1995/fix/readme-paper-typo
```

当前工作区状态：

```text
## main...origin/main [ahead 1]
```

说明：本地 `main` 相对 `origin/main` 只有 1 个额外提交，本次兼容性判断主要针对 `origin/main` 与 `upstream/main` 的体系差异。

## 3. 双方改动面

### 3.1 本地二开侧

高频改动目录：

- `lightrag_webui: 140`
- `docs: 51`
- `tests: 32`
- `lightrag: 30`

本地独有能力样本：

- `lightrag/api/graph_workbench.py`
- `lightrag/api/routers/workspace_routes.py`
- `lightrag/api/routers/prompt_config_routes.py`
- `lightrag/api/workspace_registry.py`
- `lightrag/kg/nebula_impl.py`
- `lightrag/prompt_version_store.py`
- `lightrag/prompt_versions.py`
- `lightrag_webui/src/components/graph/*`
- `lightrag_webui/src/components/workspace/*`
- `lightrag_webui/src/features/PromptManagement.tsx`

从提交主题看，本地近阶段重点在：

- workspace runtime / workspace registry
- 图谱工作台与 graph UI
- Prompt 版本管理与 API 暴露
- 文档管理体验和图谱查询交互
- Nebula / Postgres / OpenSearch 定制修复

### 3.2 上游更新侧

高频改动目录：

- `tests: 92`
- `lightrag: 81`
- `lightrag_webui: 22`
- `docs: 16`

上游独有新增能力样本：

- `lightrag/chunker/*`
- `lightrag/external_parser/*`
- `lightrag/native_parser/docx/*`
- `lightrag/pipeline.py`
- `lightrag/parser_cli.py`
- `lightrag/parser_debug.py`
- `lightrag/parser_routing.py`
- `lightrag/sidecar/*`
- `lightrag/llm_roles.py`
- `lightrag/multimodal_context.py`
- `tests/external_parser/*`
- `tests/native_parser/*`
- `tests/sidecar/*`

从提交主题看，上游近阶段重点在：

- File Processing Pipeline
- 段落语义分块与 chunk 策略扩展
- 外部解析器 / 原生 DOCX 解析
- 多模态与 sidecar 支撑
- 角色化 LLM 配置
- 队列状态、文档管线与相关测试补齐

## 4. 实际冲突面

真实 merge 冲突文件共 `16` 个：

```text
AGENTS.md
env.example
lightrag/api/lightrag_server.py
lightrag/api/routers/document_routes.py
lightrag/lightrag.py
lightrag/operate.py
lightrag/prompt.py
lightrag_webui/bun.lock
lightrag_webui/package.json
lightrag_webui/src/api/lightrag.ts
lightrag_webui/src/features/DocumentManager.tsx
lightrag_webui/src/locales/en.json
lightrag_webui/src/locales/zh.json
lightrag_webui/src/stores/state.ts
tests/test_extract_entities.py
uv.lock
```

### 4.1 高风险语义冲突

#### `lightrag/api/lightrag_server.py`

本地侧：
- workspace routes — **必须保留**
- prompt config routes — **退役计划中删除**
- `allow_prompt_overrides_via_api` — **退役计划中删除**
- `active_prompt_versions` — **退役计划中删除**

上游侧新增的是：
- `validate_parser_routing_config`
- `storage_workspaces`
- `pipeline_busy` / `pipeline_scanning`
- `vlm_process_enable`
- `embedding_timeout`
- `role_llm_config`

判断：
- **Prompt 退役后，本文件冲突面缩小约 35%。**
- 删除 prompt_config_routes import 和路由注册后，剩余冲突是：上游 pipeline/role_llm/vlm 配置 vs 本地 workspace routes。
- **操作策略：以上游为基础，把本地 workspace routes 作为补丁挂入。</strong>
- 上游的 `storage_workspaces` 与本地 `workspace_registry` 是两个独立概念（上游是存储级 workspace，本地是 API 级 workspace），需确认命名不冲突。

#### `lightrag/api/routers/document_routes.py`

本地侧保留的是：

- `_current_runtime_objects()`
- 以 workspace runtime 为中心的对象选择
- `background_tasks.add_task(...)`
- 本地 pipeline 状态查询与 track_id 流程

上游侧新增的是：

- `_reserve_enqueue_slot(rag)`
- `get_existing_doc_by_file_path_candidates(...)`
- `normalize_file_path(...)`
- 内联 `_indexing_task()` 包裹
- 新的文档列表路由与队列状态处理

判断：

- **这是本次最危险的冲突点之一。**
- 上游在文档入队、重复检测、路径归一化和分页/状态接口上更强。
- 本地在 runtime workspace 切换和后台任务接线方面更强。
- 正确做法不是二选一，而是“把上游队列/规范化逻辑嵌入本地 runtime 选择层”。

#### `lightrag/lightrag.py`

本地侧：
- `_build_runtime_global_config(...)` — **必须保留**
- `PromptVersionStore` — **退役计划中删除**
- `check_and_migrate_data()` — **必须保留**
- `arebuild_all_custom_chunks_graphs(...)` — **必须保留**
- query `model_func` 覆盖 — **必须保留**
- 图谱节点/边标准化流程 — **必须保留**

上游侧新增或强化的是：
- 类层次重构为 `LightRAG(_RoleLLMMixin, _StorageMigrationMixin, _PipelineMixin)` — **核心架构变更**
- `_build_global_config()` — 替换旧的配置构造
- Prompt profile 选择 — **吸收上游**
- `normalize_document_file_path("")`
- 更严格的 query 路径与参数处理
- 多处全局配置注入点调整

判断：
- **Prompt 退役后，冲突面缩小约 40%（删除 PromptVersionStore 及相关引用）。**
- 剩余冲突集中在两处：(1) 上游 Mixin 架构 vs 本地 workspace runtime 配置注入，(2) 本地 `arebuild_all_custom_chunks_graphs` 等特有方法。
- **操作策略：以上游 `LightRAG` 类结构为基础，把本地保留方法移植进新类。**
- `_build_runtime_global_config` 需重构为上游 `_build_global_config` 的扩展，而不是平行存在。

#### `lightrag/operate.py`

本地侧保留的是（退役计划中全部删除）：

- Prompt 配置模板与 fingerprint → **退役**
- `_resolve_indexing_runtime_addon_params(global_config)` → **退役**
- query / keyword / extract 的缓存身份扩展 → **退役**

上游侧新增或强化的是（全部保留）：

- `strip_internal_multimodal_markup_for_extraction`
- `resolve_entity_extraction_prompt_profile`
- JSON extraction 响应格式
- `llm_cache_identity`
- gleaning 结果处理链路

判断：

- **Prompt 退役计划实施后，本文件冲突面归零——直接取上游。**
- 上游在提取管线标准化、多模态标记清理、缓存身份和 gleaning 链路上显著更先进。
- 退役本地 Prompt 版本与 fingerprint 后，本地对此文件的额外改动不再有效。

#### `lightrag/prompt.py`

本地侧：

- `PromptRule`
- 结构化 prompt customization
- prompt version domain helpers

上游侧：

- `EntityExtractionPromptProfile`
- YAML 文件加载（`prompts/UserCustomizePrompts.md`、`prompts/samples/entity_type_prompt.sample.yml`）
- Prompt profile 类型化定义
- 通过 `yaml` (PyYAML) 解析 prompt 定制文件

判断：

- **Prompt 退役计划明确退掉本地版本化。本文件冲突直接取上游。**
- 上游 Profile 机制已足够支撑文件型 Prompt 定制，不需要本地并行规则体系。
- `prompts/` 目录是新的用户定制入口，应在合并后同步到本地工作区。

#### `lightrag_webui/src/api/lightrag.ts`

本地侧保留的是：

- 图谱查询范围类型
- `allow_prompt_overrides_via_api`
- `active_prompt_versions`

上游侧新增的是：

- `LightragQueueStatus`
- `role_llm_config`

判断：

- **前后端契约必须一起合。**
- 这不是单纯补字段，涉及 WebUI 如何驱动 queue/pipeline 状态与角色化配置。

#### `lightrag_webui/src/stores/state.ts`

本地侧保留的是：

- workspace create capability
- guest visible tabs
- prompt override capability

上游侧新增的是：

- `pipelineBusy`
- `pipelineActive`

判断：

- **应同时保留。**
- 上游状态机字段应并入本地 store，而不是覆盖 workspace / guest 能力。

#### `lightrag_webui/src/features/DocumentManager.tsx`

本地侧保留的是：

- document details
- custom chunks 视图/行为

上游侧新增的是：

- `getStatusBucket`
- `matchesStatusFilter`
- metadata 格式化

判断：

- 上游对文档状态筛选与展示更成熟。
- 本地的 custom chunks 与文档细节能力不能被删除。
- 适合“保页面主行为，吸收筛选与 metadata 展示工具”。

### 4.2 中风险工程冲突

#### `lightrag_webui/package.json` / `bun.lock`

- 上游依赖版本整体更新，并从 `@vitejs/plugin-react-swc` 侧走向 `@vitejs/plugin-react` 生态。
- 同时加入新的前端工具链依赖。

判断：

- **不要手工逐段合 `bun.lock`。**
- 应先定最终 `package.json`，再 `bun install --frozen-lockfile` 或重建 lock。
- 需额外核对 `vite.config.ts`、Tailwind/Vite 插件栈与本地 graph/workspace 页面是否兼容。

#### `uv.lock`

- 冲突块 `48` 个，说明 Python 依赖图谱已经明显分叉。

判断：

- **不要逐块手工合 `uv.lock`。**
- 应先确认 `pyproject.toml` 与 extras 目标，再用 `uv` 重建锁。

#### `tests/test_extract_entities.py`

本地侧新增的是：

- prompt config template 的行为测试
- 空 gleaning 响应容错测试

上游侧新增的是：

- `entity_extract_max_gleaning=0` 守卫测试
- `MAX_EXTRACT_INPUT_TOKENS=0` 守卫测试

判断：

- **两边测试都应该保留。**
- 它们覆盖的是不同维度：本地测 prompt/runtime，自上游测提取守卫。

### 4.3 低风险机械冲突

#### `env.example`

- 实际冲突只是注释说明重复。
- 但该文件承载了上游 parser / VLM / role config 新开关说明。

判断：

- 内容冲突低风险，语义价值高，建议吸收上游新增项并保留本地部署说明。

#### `AGENTS.md`

- 无 runtime 风险。
- 只影响仓库协作规则。

## 5. 自动合并但仍需警惕的文件

双方都改过、但这次 merge 自动合上的文件有 `31` 个，其中这些不能因为"没冲突"就当作安全。

### 5.1 高风险（存储实现 + 核心配置）

#### `lightrag/kg/postgres_impl.py`

| 维度 | 上游 | 本地 |
|------|------|------|
| 新增 migration | `_migrate_doc_full_add_pipeline_fields()` — 为 `LIGHTRAG_DOC_FULL` 加 `sidecar_location`/`parse_format`/`content_hash`/`process_options`/`chunk_options`/`parse_engine` 6 列 | 无 |
| 新增 migration | `_migrate_doc_status_add_content_hash()` — 为 `LIGHTRAG_DOC_STATUS` 加 `content_hash` 列 + 索引 | 无 |
| doc_status 查询 | 新增 `status_filters: list[DocStatus]` 多状态筛选参数 | 无 |
| doc_status 去重 | 新增 `get_doc_by_file_basename()` / `get_existing_doc_by_content_hash()` 等去重方法 | 无 |
| enable_vector | 移除 `POSTGRES_ENABLE_VECTOR` 变量依赖，改为自动检测 `LIGHTRAG_VECTOR_STORAGE` | 同方向：加 deprecation warning |
| graph subgraph | `get_related_nodes()` 新增 `direction` 参数（值为 `"both"`） | **同方向**：本地也加了 `direction` 参数 |

**风险**：本地的 `POSTGRES_ENABLE_VECTOR` deprecation warning 与上游的完全移除逻辑语义一致，但 wording 不同；本地的 `direction` 参数与上游版本签名相同但默认值可能源自不同提交基础。需核对合并后的最终版本，确保两个方向一致。

#### `lightrag/kg/mongo_impl.py`

| 维度 | 上游 | 本地 |
|------|------|------|
| doc_status 索引 | 新增 `content_hash` 部分索引 | 无 |
| doc_status 查询 | 新增 `status_filters: list[DocStatus]` 参数 | 无 |
| doc_status 去重 | 新增 `get_doc_by_file_basename()` 方法 | 无 |
| graph subgraph | `get_related_nodes()` 新增 `direction` 参数 | **同方向**：本地也加了 `direction` 参数 |

**风险**：中。`direction` 参数签名一致，应自动保留正确版本。主要风险是合并后的 `get_related_nodes` 调用是否同时传递了双方的参数组合。

#### `lightrag/kg/redis_impl.py`

| 维度 | 上游 | 本地 |
|------|------|------|
| doc_status 查询 | 新增 `status_filters: list[DocStatus]` 多状态筛选 | 无 |
| doc_status 去重 | 新增 `get_doc_by_file_basename()` （约 90 行新方法） | 无 |

**风险**：低。上游纯增量，本地无冲突改动。但需确认本地 Redis 连接配置与上游兼容。

#### `lightrag/kg/opensearch_impl.py`

上游新增 `status_filters` 参数和去重方法。本地对此文件有 Nebula 相关的跨存储适配修改。

**风险**：高。OpenSearch 是本地的关键存储后端（配合 Nebula），上游对 OpenSearch 的索引和查询路径改动可能影响本地的文档检索序列。**合并后必须跑 `tests/test_opensearch_storage.py` 完整回归。**

#### `lightrag/api/config.py`

| 维度 | 上游 | 本地 |
|------|------|------|
| 新增验证 | `validate_bedrock_auth_configuration()` | 无 |
| 新增绑定 | `normalize_binding_name()`、`get_binding_env_value()` | 无 |
| Bedrock binding | LLM_BINDING_HOST fallback 改为 `DEFAULT_BEDROCK_ENDPOINT` | 无 |
| Gemini binding | LLM_BINDING_HOST fallback 改为 `DEFAULT_GEMINI_ENDPOINT` | 无 |
| 新增 timeout | `DEFAULT_LLM_TIMEOUT`、`DEFAULT_EMBEDDING_TIMEOUT`、`DEFAULT_RERANK_TIMEOUT` | 无 |
| 角色 LLM 配置 | 引入 `ROLES` 循环，为每个 role 校验 auth | 无 |
| guest 配置 | 无 | `enable_guest_login_entry`、`guest_visible_tabs`、`AUTH_ACCOUNTS` 样例值守卫 |
| workspace | 无 | `sanitize_workspace_identifier` import |
| prompt override | 无 | `allow_prompt_overrides_via_api`、`active_prompt_versions`（退役计划中删除） |
| graph config | `max_graph_nodes` 默认 1000 | `max_graph_nodes` 默认 10000 |

**风险**：中。双方改动面重叠但功能方向不同。自动合并后需确认：
1. 本地 `guest_visible_tabs` 和 `sanitize_workspace_identifier` import 是否保留
2. `max_graph_nodes` 默认值冲突——应取较大值（本地 10000）或上游默认并让部署覆盖
3. `allow_prompt_overrides_via_api` / `active_prompt_versions` 随退役计划删除后，config.py 的冲突面应自动减小

#### `pyproject.toml`

| 依赖 | 上游 | 本地 | 合并策略 |
|------|------|------|----------|
| `google-genai` | `>=1.0.0,<3.0.0` | 旧版本（`<2.0.0`） | **取上游** |
| `PyYAML` | `>=6.0,<7.0`（新增） | 无 | **吸收**，上游 prompt 加载依赖此包 |
| `langchain-text-splitters` | `>=0.3,<2`（新增） | 无 | **吸收**，R 分块策略依赖 |
| `langchain-experimental` | `>=0.3,<1`（新增） | 无 | **吸收**，V 分块策略依赖 |
| `defusedxml` | `>=0.7.0,<1.0.0`（新增） | 无 | **吸收**，native DOCX 解析依赖 |
| `pymilvus` | `>=2.6.2,<4.0.0` | `>=2.6.2,<3.0.0` | **取上游**（上限放宽） |
| `qdrant-client` | `>=1.11.0,<2.0.0` | `>=1.17.1,<2.0.0` | **保留本地**（更高下限） |
| `nebula3-python` | 无 | `>=3.8.3,<4.0.0` | **必须保留** |
| `docling` extra | 已并入 `api` extra | 无 | **改为 `api` extra 统一安装** |
| test extra | 无 `anthropic`/`voyageai` | `>=0.18.0` / `>=0.2.0` | **保留本地**，补齐 provider 测试 |

**风险**：高。`pyproject.toml` 的分歧点最多，且影响 `uv.lock` 重建。**必须先定 `pyproject.toml` 最终版，再 `uv sync` 重建锁文件。** 本地新增的 `nebula3-python` 不可丢失。

### 5.2 中风险（构建链 + 部署脚本）

#### `scripts/setup/setup.sh`

上游新增：
- parser routing / VLM / role config 的环境变量读写
- Bedrock auth 配置步骤
- Pipeline 超时和 parser engine 选项

本地新增：
- workspace 环境变量
- guest 登录配置
- Nebula 适配的环境变量

**风险**：合并后需确认所有环境变量均在 setup.sh 中有对应配置段，否则新用户在 setup 后缺少关键变量。

#### `lightrag_webui/package.json` 配套文件

虽然 `package.json` 本身是冲突文件（已在 4.2 分析），但自动合并的文件中还有：
- `lightrag_webui/vite.config.ts`：需确认本地 graph/workspace 插件兼容上游更新的 Vite 插件栈
- `lightrag_webui/tsconfig.json` 及其引用链
- `lightrag_webui/tailwind.config.ts`：本地 graph 工作台可能使用了自定义 Tailwind 配置

### 5.3 低风险（文档 + 测试基础设施）

- `requirements-offline*.txt`：需同步 `pyproject.toml` 变更后重新生成
- `tests/conftest.py`：上游新增 fixture 可能与本地 workspace 测试的 fixture 命名冲突
- `tests/test_opensearch_storage.py`：上游新增内容去重和状态筛选测试；本地有 Nebula 相关测试——**合并后必须全跑**

### 5.4 需同步更新的自动合并文件清单

```text
高风险（5 个）：
  lightrag/kg/postgres_impl.py
  lightrag/kg/mongo_impl.py
  lightrag/kg/opensearch_impl.py
  lightrag/api/config.py
  pyproject.toml

中风险（4 个）：
  lightrag/kg/redis_impl.py
  scripts/setup/setup.sh
  lightrag_webui/vite.config.ts       # 非直接改但依赖栈变
  lightrag_webui/tailwind.config.ts   # 同上

低风险（需走测试）（3 个）：
  tests/conftest.py
  tests/test_opensearch_storage.py
  requirements-offline*.txt
```

## 6. 双方代码优劣与吸收策略

### 6.1 上游更强的部分

- 文件处理总线更完整：`pipeline.py`、parser routing、sidecar、debug CLI
- 分块策略体系更成熟：`chunker/*`
- 多模态与原生文档解析能力更强：`native_parser/docx/*`、`multimodal_context.py`
- 提取链路的缓存身份与 JSON 输出更规范：`operate.py`
- 测试覆盖显著更强：新增大量 parser / sidecar / chunking / provider 测试

建议：

- **这些能力应优先吸收。**

### 6.2 本地更强的部分

- workspace 生命周期与 guest 能力
- 图谱工作台、图谱编辑和图谱导入产品化能力
- Prompt 版本管理、结构化 Prompt 定制和前后端联动
- Nebula 适配与本地部署差异处理
- 本地文档管理 / custom chunks 使用路径

建议：

- **这些能力必须保留。**

### 6.3 最合理的架构方向

- 让上游继续作为“通用引擎”和“文件处理平台”。
- 让本地代码承担“产品壳层”和“环境适配层”。
- 对 `lightrag.py`、`operate.py`、`document_routes.py` 这类共享入口，优先把本地逻辑收敛为扩展点，而不是整段长期 fork。

## 7. 是否可以合并

### 结论

可以，但条件是：

1. 只在集成分支或隔离 worktree 上做。
2. 先解决共享入口和锁文件策略，再解决页面契约。
3. 合并后必须跑完整 lint / pytest / bun build / bun test。

### 不建议的做法

- 直接在 `main` 上 `git merge upstream/main`
- 先合代码、后补验证
- 逐块手工合 `uv.lock` / `bun.lock`
- 为了省事直接回退本地 workspace / prompt / graph 能力

## 8. 推荐落地顺序

1. 从 `main` 切集成分支，复用 `docs/aegis/sop/upstream-merge-sop.md`
2. **先退役 Prompt Management（前置步骤）**：
   - 删除后端：`prompt_config_routes.py`、`prompt_version_store.py`、`prompt_versions.py`
   - 删除前端：`PromptManagement.tsx` 及关联组件、prompt override hooks
   - 收口 API 契约：删除 `prompt_overrides`、`allow_prompt_overrides_via_api`、`active_prompt_versions`
   - 提交：`git commit -m "retire(prompt): retire local prompt management in favor of upstream prompt profiles"`
3. 在集成分支执行受控 merge：`git merge --no-commit --no-ff upstream/main`
4. 先定清单：
   - 本地必须保留：workspace、graph、Nebula、部署差异
   - 上游必须吸收：chunker、parser、pipeline、sidecar、role config、prompt profile、新测试
5. 按 Section 15 逐文件解决清单依次处理冲突
6. 先处理共享入口：
   - `lightrag/lightrag.py`
   - `lightrag/api/lightrag_server.py`
   - `lightrag/api/routers/document_routes.py`
   - `lightrag/prompt.py`（直接取上游）
   - `lightrag/operate.py`（直接取上游）
7. 再处理 WebUI 契约：
   - `lightrag_webui/src/api/lightrag.ts`
   - `lightrag_webui/src/stores/state.ts`
   - `lightrag_webui/src/features/DocumentManager.tsx`
8. 最后统一重建锁文件：
   - `uv sync --extra api --extra test --extra offline-storage --extra offline-llm`
   - `cd lightrag_webui && bun install --frozen-lockfile`
9. 运行验证（按 Section 14.3 的 Phase 1-4）

## 9. 退役轨

本次不只是"修复轨"，还要同时考虑退役轨。

### 9.1 明确退役项（Prompt Management）

基于 `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`，以下模块和契约显式退役：

| 退役对象 | 类型 | 替代方案 |
|----------|------|----------|
| `lightrag/api/routers/prompt_config_routes.py` | 删除文件 | 上游 `prompts/` 文件型定制 |
| `lightrag/prompt_version_store.py` | 删除文件 | 上游 prompt profile 解析 |
| `lightrag/prompt_versions.py` | 删除文件 | 上游 prompt profile 解析 |
| `lightrag_webui/src/features/PromptManagement.tsx` | 删除文件 | 无 WebUI 替代；定制通过 `prompts/` 文件 |
| `lightrag_webui/src/components/prompt-management/*` | 删除目录 | 同上 |
| `lightrag_webui/src/components/retrieval/PromptOverridesEditor.tsx` | 删除文件 | 上游仅保留 `user_prompt` 简单输入 |
| `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.tsx` | 删除文件 | 无 WebUI 替代 |
| `lightrag_webui/src/utils/promptVersioning.ts` | 删除文件 | 无替代 |
| `allow_prompt_overrides_via_api` | 删除配置 | 上游无此概念 |
| `active_prompt_versions` | 删除 health 字段 | 上游无此概念 |
| `/query` 中的 `prompt_overrides` | 删除 API 契约 | 上游 `/query` schema |
| Prompt Management tab (guest visible) | 删除 UI 入口 | 从 guest_visible_tabs 移除 |
| OpenAPI schema 中的 prompt_overrides | 删除 schema | 收缩 Dify/外部 schema |
| `tests/test_prompt_config*.py` | 删除测试 | 上游 profile 测试覆盖 |

### 9.2 条件退役项（上游覆盖时）

| 退役对象 | 条件 | 替代方案 |
|----------|------|----------|
| 本地自定义 chunking_func 注入 | 若上游 F/R/V/P 策略覆盖全部使用场景 | 移除自定义注入，使用上游 `process_options` 选择 |
| WebUI 旧版 pipeline 状态拼装 | 若上游 `pipelineBusy`/`pipelineActive` 语义一致 | 切换到上游状态字段 |
| 本地文档入队锁/去重 | 若上游 `_reserve_enqueue_slot` + `get_existing_doc_by_file_path_candidates` 覆盖 | 切换到上游入队机制 |

### 9.3 必须保留项（不可退役）

| 保留对象 | 原因 |
|----------|------|
| workspace 生命周期 / workspace_registry | 本地产品能力，上游无等价 |
| 图谱工作台 (graph workbench) | 本地产品能力，上游无等价 |
| Nebula 适配 (`lightrag/kg/nebula_impl.py`) | 本地环境依赖，上游无此存储 |
| guest login / guest_visible_tabs | 本地产品能力 |
| `lightrag-webui` build/dev 工具链与插件配置 | 本地 graph/workspace 页面依赖 |
| `pyproject.toml` 中的 `nebula3-python` 和 `qdrant-client` 版本 | 本地环境依赖

## 10. 证据范围与残余风险

### 已覆盖证据

- 上游拉取结果
- 分叉点与 ahead/behind 统计
- 改动文件热区
- 上游/本地新增能力清单
- 真实 merge 冲突清单
- 关键冲突块的双方摘要
- **上游新模块架构依赖分析**（pipeline / chunker / external_parser / native_parser / sidecar / role_llm / multimodal_context / parser_routing）
- **自动合并文件的逐文件风险评估**（存储实现 / config / pyproject.toml / setup 脚本）
- **Prompt 退役对冲突面的修正影响**
- **逐文件操作指令**（16 个冲突文件的具体解决策略）
- **测试策略与迁移计划**（92 个上游新测试 + 本地测试去留判断）

### 未覆盖证据

- 未对"解决冲突后的代码"跑自动化验证，因为当前仍停留在分析阶段
- 未确认 `package.json` 最终方案下的 `vite.config.ts` / 构建链是否需要同步调整
- 未验证自动合并的存储实现是否存在语义回归

### 最小人工验证步骤

1. 在集成分支重演 merge
2. 先解决高风险共享入口冲突
3. 重建 `uv.lock` 与 `bun.lock`
4. 跑 `ruff`、`./scripts/test.sh`、`bun build`、`bun test`
5. 补跑 `tests/test_opensearch_storage.py`、`tests/test_postgres_*`、`tests/test_interactive_setup/*`

## 11. 对既有计划的修正

`docs/aegis/plans/2026-05-08-upstream-main-merge.md` 与 `docs/aegis/sop/upstream-merge-sop.md` 的**流程纪律仍然有效**，但其中的提交数量与冲突面已经过时。

本次更新后的新事实是：

- 共同祖先推进到了 `2026-05-12`
- 上游新增能力从“少量同步”升级为“文件处理与解析链路的大版本扩展”
- 冲突中心从此前的 API / storage / setup，扩大到 prompt/profile、document pipeline、WebUI document manager 和锁文件体系

因此，本次更适合被视为一次**平台能力升级合并**，而不是常规追平。

## 12. Prompt 退役对冲突面的修正分析

`docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md` 要求在合并过程中彻底退役本地 Prompt Management 能力。该决策直接改变了多个冲突文件的解决策略。

### 12.1 冲突面收缩矩阵

| 冲突文件 | 退役前冲突规模 | 退役后冲突规模 | 收缩原因 |
|----------|---------------|---------------|----------|
| `lightrag/prompt.py` | 高（两套体系并行） | **零（直接取上游）** | 本地 `PromptRule` / 版本化 Helper 全部删除 |
| `lightrag/operate.py` | 高（fingerprint + runtime addon） | **零（直接取上游）** | 删除 Prompt 配置模板/fingerprint 和 `_resolve_indexing_runtime_addon_params` 后，本地无剩余有效改动 |
| `lightrag/lightrag.py` | 高（PromptVersionStore 注入 + global_config） | **中**（仅剩 runtime config + 特有能力） | 删除 `PromptVersionStore` 和与之绑定的初始化逻辑后，剩余冲突聚焦在 workspace runtime 配置和方法移植 |
| `lightrag/api/lightrag_server.py` | 高（workspace + prompt routes） | **中**（仅剩 workspace routes 拼接） | 删除 `prompt_config_routes` 注册和 `allow_prompt_overrides_via_api`/`active_prompt_versions` 后，只需挂载 workspace routes |
| `lightrag_webui/src/api/lightrag.ts` | 中（prompt override types） | **低**（仅剩上游新字段并入） | 删除 `allow_prompt_overrides_via_api`、`active_prompt_versions` 类型后，只需吸收上游 `LightragQueueStatus`/`role_llm_config` |
| `lightrag_webui/src/stores/state.ts` | 中（prompt capability flags） | **低**（仅剩上游 pipeline 状态并入） | 删除 prompt override 能力位后，只需吸收 `pipelineBusy`/`pipelineActive` |
| `tests/test_extract_entities.py` | 低（两边各自加了测试） | **低**（本地 prompt 测试需迁移或删除） | 本地 prompt config 测试如依赖退役的文件需同步删除 |

### 12.2 退役带来的文件新增影响

除了冲突文件外，退役还引入以下文件上的操作：

- **删除** `lightrag/api/routers/prompt_config_routes.py`
- **删除** `lightrag/prompt_version_store.py`
- **删除** `lightrag/prompt_versions.py`
- **删除** `lightrag_webui/src/features/PromptManagement.tsx` 及关联组件
- **修改** `lightrag_webui/src/App.tsx`、`lightrag_webui/src/features/SiteHeader.tsx`（移除 Prompt Management tab）
- **修改** `lightrag_webui/src/features/RetrievalTesting.tsx`、`lightrag_webui/src/components/retrieval/QuerySettings.tsx`（移除 prompt override UI）
- **修改** `lightrag/api/routers/query_routes.py`（删除 `prompt_overrides` 参数处理）
- **修改** `lightrag/base.py`（删除 prompt override 相关类型定义）

这些删除操作应在冲突解决之前执行，因为删除后的代码不再参与冲突——**"先退役、再合并"是最优顺序。**

### 12.3 退役需保留的上游能力

退役本地 Prompt Management 后，以下上游能力成为唯一 Prompt 定制路径，必须确保完整可用：

| 上游能力 | 文件 | 状态 |
|----------|------|------|
| `EntityExtractionPromptProfile` | `lightrag/prompt.py` | **上游新增，直接使用** |
| YAML prompt 加载 | `lightrag/prompt.py` | **依赖 `PyYAML>=6.0`，需确认依赖已加入** |
| `prompts/UserCustomizePrompts.md` | `prompts/` | **上游新增，合并后加入工作区** |
| `prompts/samples/entity_type_prompt.sample.yml` | `prompts/samples/` | **上游新增，需确保路径正确** |

## 13. 上游模块架构依赖分析

上游本次新增 8 个功能模块（~29k 行代码），以下是各模块职责、内部依赖和与本地代码的交叉点分析。

### 13.1 `lightrag/pipeline.py` — 文档处理总线（4486 行新增）

类结构：`_PipelineMixin` 以 Mixin 方式挂入 `LightRAG`（多继承）。

三阶段流水线架构：

```
parse (native/mineru/docling) → analyze (chunking + multimodal context) → process (extraction)
```

**核心依赖**：
- `lightrag/parser_routing.py` — 解析器引擎选择
- `lightrag/chunker/` — 分块策略选择
- `lightrag/sidecar/` — 解析结果标准化写入
- `lightrag/multimodal_context.py` — 多模态上下文富化
- `lightrag/operate.py` — 实体提取调用
- `lightrag/utils_pipeline.py` — 管线专属工具函数

**与本地代码的交叉点**：
- `document_routes.py`：本地 `_current_runtime_objects()` 返回的 RAG 实例必须能正确触发 `_PipelineMixin` 的方法
- `lightrag.py`：本地的 `arebuild_all_custom_chunks_graphs` 需要分别挂入新类结构

### 13.2 `lightrag/chunker/` — 分块策略（2057 行新增）

4 种策略，通过 `process_options` 字符串中的单字符选择：

| 策略 | 字符 | 文件 | 依赖 | 说明 |
|------|------|------|------|------|
| Fixed Token | `F` | `token_size.py` (128行) | 仅 `tokenizer` | 原有逻辑重新封装 |
| Recursive Character | `R` | `recursive_character.py` (110行) | `langchain-text-splitters` | LangChain `RecursiveCharacterTextSplitter` 封装 |
| Semantic Vector | `V` | `semantic_vector.py` (217行) | `langchain-experimental` + `embedding_func` | 语义相似度检测断点 |
| Paragraph Semantic | `P` | `paragraph_semantic.py` (1503行) | `native_parser/docx` + sidecar `blocks.jsonl` | 最复杂；依赖标题层级感知 |

两种契约共存：
- **Legacy 契约**：`chunking_by_token_size()` 保持 6 参数签名，供外部 `chunking_func` 替换
- **File-chunker 契约**：标准签名 `(tokenizer, content, chunk_token_size, *, **kwargs)`，供 pipeline 调用

**与本地代码的交叉点**：无直接冲突。但本地如果通过 `LightRAG.chunking_func` 注入了自定义分块函数，该函数的调用路径可能随上游双契约逻辑改变。

### 13.3 `lightrag/external_parser/` — 外部解析引擎（3459 行新增）

```
external_parser/
├── _common.py (152行)          — 共享工具（size/hash, env 类型转换）
├── _manifest.py (167行)        — 原子 manifest 读写（MANIFEST_VERSION=1）
├── _zip.py (42行)              — 安全 ZIP 解压
├── docling/ (1828行)           — Docling 引擎适配
│   ├── client.py (344行)       — HTTP API: upload → poll status → download result
│   ├── cache.py (228行)        — 本地 raw bundle 缓存（按 content_hash 索引）
│   ├── ir_builder.py (1085行)  — Docling 输出 → IRDoc 标准化
│   └── manifest.py (130行)     — Docling 专用 manifest 校验
└── mineru/ (2011行)            — MinerU 引擎适配
    ├── client.py (677行)       — HTTP API（支持 official/local 两种模式）
    ├── cache.py (397行)        — 本地缓存
    ├── ir_builder.py (749行)   — MinerU 输出 → IRDoc 标准化
    └── manifest.py (164行)     — MinerU 专用 manifest 校验
```

**与本地代码的交叉点**：无直接冲突。这些是全新模块。但需确认本地部署环境是否具备 Docling/MinerU 服务端点（上游默认要求外部服务）。

### 13.4 `lightrag/native_parser/docx/` — 原生 DOCX 解析（4860 行新增）

```
native_parser/docx/
├── parse_document.py (1892行)       — 主解析管线（Word → IRDoc）
├── utils.py (791行)                 — 工具函数（字体、样式、颜色处理）
├── table_extractor.py (405行)       — 表格提取（单元格合并还原）
├── drawing_image_extractor.py (445行) — 图片/图表提取（EMF→PNG 转换）
├── ir_builder.py (339行)            — DOCX IR → IRDoc 适配
├── numbering_resolver.py (423行)    — 编号/列表项解析
├── omml/ (599行)                    — Office Math Markup Language (OMML) → MathML 转换
│   ├── ommlparser.py (511行)
│   ├── cleaners.py (38行)
│   └── utils.py (40行)
```

**依赖**：`python-docx>=0.8.11`、`defusedxml>=0.7.0`（上游已在 `pyproject.toml` 中加入 `defusedxml`）

**与本地代码的交叉点**：无直接冲突。但本地如果有自定义 DOCX 处理逻辑需确认与此新路径不重叠。

### 13.5 `lightrag/sidecar/` — Sidecar 格式标准化（990 行新增）

```
sidecar/
├── ir.py (213行)           — 中间表示类型定义（IRDoc/IRBlock/IRDrawing/IREquation/IRTable/IRPosition/AssetSpec）
├── placeholders.py (117行) — 占位符处理
├── writer.py (627行)       — 入口：write_sidecar() → *.parsed/ 目录输出
```

**数据流**：所有 parser（native/docling/mineru）→ 各自 `ir_builder.py` → `IRDoc` → `write_sidecar()` → `*.parsed/` 目录。

**与本地代码的交叉点**：无直接冲突。但 `*.parsed/` 目录可能与本地的文档存储目录（`rag_storage/`、`inputs/`）存在路径交叉。

### 13.6 `lightrag/llm_roles.py` — 角色化 LLM 配置（572 行新增）

上游核心架构变更之一。为 `LightRAG` 新增 `_RoleLLMMixin`，支持 4 个角色的独立 LLM 绑定：

| 角色 | 环境变量前缀 | 用途 |
|------|-------------|------|
| `extract` | `EXTRACT_` | 实体提取 |
| `keyword` | `KEYWORD_` | 关键词提取 |
| `query` | `QUERY_` | 查询 |
| `vlm` | `VLM_` | 多模态视觉处理 |

每个角色可独立配置：LLM binding/model/max_async/timeout。通过 `RoleSpec` / `RoleLLMConfig` / `_RoleLLMState` 三层建模。

**与本地代码的交叉点**：
- `lightrag_server.py`：需暴露 `role_llm_config` 到 health/config 接口
- `lightrag.py`：本地 `_build_runtime_global_config` 需产出兼容 `_RoleLLMMixin` 期望的配置结构
- `.env` / setup.sh：需新增 `EXTRACT_LLM_BINDING`、`KEYWORD_LLM_BINDING` 等环境变量

### 13.7 `lightrag/multimodal_context.py` — 多模态上下文富化（1028 行新增）

为 sidecar 中的 `drawings.json` / `tables.json` / `equations.json` 条目提取上下文文本（leading + trailing），供 VLM 分析使用。

**与本地代码的交叉点**：无直接冲突。但若本地 graph workbench 需要展示多模态内容（图表/公式），需对接 sidecar 的上下文提取流程。

### 13.8 `lightrag/parser_routing.py` — 解析器路由与 process_options（896 行新增）

- `ProcessOptions`：解析 `i/t/e/!/F/R/V/P` 字符串为结构化配置
- `resolve_file_parser_directives()`：根据文件名后缀提示和配置确定 parser engine
- `resolve_stored_document_parser_engine()`：从已存储文档元数据推断 parser engine
- `resolve_chunk_options()`：解析和验证分块参数快照

**与本地代码的交叉点**：
- `document_routes.py`：本地上传/处理流程需要调用 `resolve_file_parser_directives` 来确定使用哪个 parser engine

### 13.9 模块依赖总图

```
pipeline.py ──────────┬── parser_routing.py
                      ├── chunker/ (F/R/V/P)
                      ├── external_parser/ (docling/mineru)
                      ├── native_parser/docx/
                      ├── sidecar/ (IR + writer)
                      ├── multimodal_context.py
                      ├── utils_pipeline.py
                      └── lightrag.py (operate / storage)

llm_roles.py ─────────┬── lightrag.py (Mixin 挂入)
                      └── lightrag_server.py (config 暴露)

prompt.py ────────────┬── prompts/ (YAML 文件)
                      └── operate.py (运行时解析)
```

## 14. 测试策略与迁移

### 14.1 上游新增测试（92 文件 / ~25k 行）

按模块分布：

| 模块 | 测试文件数 | 典型测试 | 是否直接可跑 |
|------|-----------|---------|-------------|
| `tests/external_parser/` | 7 | Docling/MinerU 的 cache/client/ir_builder 单元测试 | 需 Docling/MinerU 服务 |
| `tests/native_parser/` | 3 | DOCX golden 测试 + security 测试 | 需 `python-docx`, `defusedxml` |
| `tests/sidecar/` | 1 | `test_writer.py` (612行) | 可直接跑（纯本地） |
| `tests/test_pipeline_*` | 2 | `test_pipeline_analyze_multimodal.py` (984行), `test_pipeline_release_closure.py` (3389行) | 可能依赖外部解析器 |
| `tests/test_chunk*` | 5 | 各 chunk 策略的单元测试 | `test_chunker_recursive_character` / `test_chunker_semantic_vector` 需 langchain 依赖 |
| `tests/test_llm_role_runtime.py` | 1 | 1117 行角色 LLM 集成测试 | 需 LLM 绑定 |
| `tests/test_bedrock_llm.py` | 1 | 902 行 Bedrock LLM 测试 | 需 AWS 凭证 |
| `tests/test_gemini_llm.py` | 1 | 202 行 Gemini LLM 测试 | 需 API key |
| `tests/test_document_routes_docx_archive.py` | 1 | 1959 行 DOCX 归档流程测试 | 需 pipeline 链路 |
| `tests/test_content_hash_normalization.py` | 1 | 70 行去重哈希测试 | 可直接跑 |
| `tests/test_vlm_*` | 2 | 185 + 135 行 VLM 测试 | 需 VLM 绑定 |
| `tests/test_parse_*` | 4 | parser e2e + sidecar 测试 | 需外部/原生解析器 |

**判断**：大部分上游新增测试依赖外部服务（LLM/VLM/parser 端点），不能在纯 CI 环境下直接跑。建议：
- 将依赖外部服务的测试归入 `integration` 标记
- 纯本地测试（content_hash、chunk worker、sidecar writer、parser routing validation）加入 `offline` 默认运行集

### 14.2 本地独有测试的去留判断

| 测试文件 | 依赖 Prompt Management? | 去留 |
|---------|------------------------|------|
| `tests/test_prompt_config.py` | **是** | 删除（随退役计划） |
| `tests/test_prompt_config_routes.py` | **是** | 删除 |
| `tests/test_prompt_version_runtime.py` | **是** | 删除 |
| `tests/test_prompt_version_store.py` | **是** | 删除 |
| `tests/test_prompt_versioning.py` | **是** | 删除 |
| `tests/test_query_prompt_customization.py` | **是** | 删除（或重写为上游 profile 测试） |
| `tests/test_query_prompt_overrides_api.py` | **是** | 删除 |
| `tests/test_workspace_*.py` (5 文件) | 否 | **保留** |
| `tests/test_nebula_graph_storage.py` | 否 | **保留** |
| `tests/test_guest_login_auth_dependency.py` | 否 | **保留** |
| `tests/test_graph_directional_toggle.py` | 否 | **保留** |
| `tests/test_startup_migration_timeout.py` | 否 | **保留** |

### 14.3 合并后推荐验证路径

```
Phase 1 — 语法与导入
  ruff check lightrag/ tests/
  python -c "import lightrag"  (确认上游新模块可导入)

Phase 2 — 离线单元测试
  python -m pytest tests/ -q -m "not integration" \
    --ignore=tests/test_prompt_config.py \
    --ignore=tests/test_prompt_config_routes.py \
    ... (排除已退役的 prompt 测试)

Phase 3 — 存储回归
  python -m pytest tests/test_opensearch_storage.py \
    tests/test_postgres_upsert.py \
    tests/test_mongo_storage.py \
    tests/test_redis_doc_status_lookup.py \
    tests/test_nebula_graph_storage.py -q

Phase 4 — 前端
  cd lightrag_webui && bun run build && bun test

Phase 5 — 集成测试（需外部服务时选跑）
  LIGHTRAG_RUN_INTEGRATION=true python -m pytest tests/ \
    -m "integration" -q --run-integration
```

### 14.4 存储测试的特别提醒

`tests/test_opensearch_storage.py` 是最危险的自动合并文件：
- 上游新增了 `content_hash` 索引和 `status_filters` 测试
- 本地新增了 Nebula 双存储的相关测试（如果存在）
- 合并后需要确认所有测试的 fixture 和 assertion 仍兼容

## 15. 冲突解决清单（逐文件操作指令）

基于以上分析（含 Prompt 退役），给出每个冲突文件的具体操作指令：

### 15.1 直接取上游的文件

| 文件 | 操作 | 理由 |
|------|------|------|
| `lightrag/prompt.py` | **取上游全部** | Prompt 退役后本地改动全部失效 |
| `lightrag/operate.py` | **取上游全部** | 退役后本地 fingerprint/runtime addon 全部失效；上游提取管线显著更优 |
| `AGENTS.md` | **取上游** | 无 runtime 影响，只需保留仓库协作规则 |

### 15.2 以上游为基础 + 本地补丁的文件

| 文件 | 操作 | 具体指令 |
|------|------|----------|
| `lightrag/lightrag.py` | 取上游结构 + 移植本地方法 | 1) 确认 Mixin 继承链完整 2) 将 `check_and_migrate_data` / `arebuild_all_custom_chunks_graphs` / query `model_func` 覆盖 / 图谱标准化方法移植进新类结构 3) `_build_runtime_global_config` 改为 `_build_global_config` 的扩展调用 4) 删除所有 `PromptVersionStore` 引用 |
| `lightrag/api/lightrag_server.py` | 取上游全部 + 挂载 workspace routes | 1) 删除 `prompt_config_routes` import 和路由注册 2) 删除 `allow_prompt_overrides_via_api` / `active_prompt_versions` 的 health/config 暴露 3) 保留 workspace routes 注册 4) 吸收上游 pipeline_busy / role_llm_config / vlm 配置 |
| `lightrag/api/routers/document_routes.py` | 以上游入队逻辑包裹本地 runtime 选择 | 1) 保留本地 `_current_runtime_objects()` 2) 把上游 `_reserve_enqueue_slot` / `get_existing_doc_by_file_path_candidates` / `normalize_file_path` 嵌入本地 runtime 选择层 3) 确保 workspace 上下文正确传递到上游 pipeline 方法 |

### 15.3 需保留本地为主 + 吸收上游字段的文件

| 文件 | 操作 | 具体指令 |
|------|------|------|
| `lightrag_webui/src/stores/state.ts` | 保留本地 workspace/guest + 并入上游 pipeline 状态 | `pipelineBusy` / `pipelineActive` 作为新字段加入，不覆盖本地 workspace create / guest visible tabs |
| `lightrag_webui/src/features/DocumentManager.tsx` | 保留本地 custom chunks + 吸收上游状态筛选 | 1) 保留 document details / custom chunks 视图 2) 吸收上游 `getStatusBucket` / `matchesStatusFilter` / metadata 格式化 |

### 15.4 需前后端联合处理的文件

| 文件 | 操作 |
|------|------|
| `lightrag_webui/src/api/lightrag.ts` | 删除本地 `allow_prompt_overrides_via_api` / `active_prompt_versions` 类型；吸收上游 `LightragQueueStatus` / `role_llm_config` 类型 |
| `lightrag_webui/src/locales/en.json` / `zh.json` | 删除 prompt management / override 专属翻译键；吸收上游新增的 pipeline/status 翻译项 |

### 15.5 需手动重建的文件（不要逐块合）

| 文件 | 操作 |
|------|------|
| `uv.lock` | 定稿 `pyproject.toml` → `uv sync --extra api --extra test --extra offline-storage --extra offline-llm` |
| `lightrag_webui/bun.lock` | 定稿 `package.json` → `cd lightrag_webui && bun install --frozen-lockfile` |
| `lightrag_webui/package.json` | 手工合并上游新依赖（@vitejs/plugin-react 替代 swc） + 本地 graph/workspace 需要的依赖 |
| `env.example` | 吸收上游 parser/VLM/role 新变量，保留本地 workspace/guest/Nebula 变量 |

### 15.6 低风险的机械合并

| 文件 | 操作 |
|------|------|
| `tests/test_extract_entities.py` | 取上游测试；本地 prompt config 测试如仍引用退役文件需删除；本地 gleaning 容错测试如不依赖退役代码可保留 |
