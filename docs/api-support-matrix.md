# LightRAG API 支持矩阵

本文档用于梳理 LightRAG 当前对外 HTTP API 的支持范围，并区分以下几类情况：

- 已支持：代码中已实现并由服务入口挂载。
- 部分支持：代码中已实现，但受后端能力、配置开关或运行时条件限制。
- 未支持：核心能力存在，但当前没有对外 HTTP API；或兼容协议未实现。
- 文档缺口：代码已实现，但公开文档未完整列出。

本文档基于 2026-03-30 的静态代码与测试证据整理，未实际启动服务做运行时探测。

详细用法、参数说明和示例请配合阅读：

- `docs/LightRAG-API-Server.md`
- `docs/LightRAG-API-Server-zh.md`

## 服务入口

LightRAG API 的主入口由 `lightrag/api/lightrag_server.py` 创建并挂载，当前纳入服务的主要路由组包括：

- `documents`
- `query`
- `graph`
- `prompt-config`
- `workspaces`
- `ollama` 兼容接口，挂载在 `/api/*`

## 一览结论

当前 LightRAG 对外 HTTP API 已覆盖以下能力域：

| 能力域                | 状态   | 说明                                                                            |
| --------------------- | ------ | ------------------------------------------------------------------------------- |
| 系统与鉴权            | 已支持 | 包括 `/health`、`/docs`、`/auth-status`、`/login`                               |
| 文档管理              | 已支持 | 包括上传、扫描、文本写入、分页、状态、删除、重建、重试、取消流水线              |
| 查询                  | 已支持 | 包括 `/query`、`/query/stream`、`/query/data`                                   |
| 图谱操作              | 已支持 | 包括图查询、标签检索、实体关系增删改、实体合并                                  |
| Prompt 版本管理       | 已支持 | 包括初始化、列举、创建、更新、激活、删除、diff                                  |
| Workspace 管理        | 已支持 | 包括创建、查看、统计、软删、恢复、硬删、操作状态                                |
| Ollama 兼容协议       | 已支持 | 当前只实现 `/api/version`、`/api/tags`、`/api/ps`、`/api/generate`、`/api/chat` |
| OpenAI 风格服务端协议 | 未支持 | 未发现 `/v1/chat/completions`、`/v1/embeddings`、`/v1/responses` 等接口         |

## 已支持 API 矩阵

### 1. 系统与鉴权

| 路径                    | 方法 | 状态   | 备注                                                                           |
| ----------------------- | ---- | ------ | ------------------------------------------------------------------------------ |
| `/`                     | GET  | 已支持 | 根路径按 WebUI 资源是否存在跳转到 `/webui` 或 `/docs`                          |
| `/docs`                 | GET  | 已支持 | 自定义 Swagger UI                                                              |
| `/docs/oauth2-redirect` | GET  | 已支持 | Swagger OAuth2 跳转                                                            |
| `/redoc`                | GET  | 已支持 | ReDoc 文档页                                                                   |
| `/openapi.json`         | GET  | 已支持 | OpenAPI Schema                                                                 |
| `/auth-status`          | GET  | 已支持 | 返回当前鉴权模式；未配置鉴权时可返回 guest token                               |
| `/login`                | POST | 已支持 | 表单登录；未配置鉴权时回落到 guest token                                       |
| `/health`               | GET  | 已支持 | 返回配置、版本、workspace、pipeline 状态、capabilities、active prompt versions |
| `/webui`                | GET  | 已支持 | 当前端资源存在时挂载静态页面                                                   |

### 2. 文档管理

文档路由统一挂载在 `/documents` 前缀下。

| 路径                                       | 方法   | 状态   | 备注                                                         |
| ------------------------------------------ | ------ | ------ | ------------------------------------------------------------ |
| `/documents/rebuild_from_indexing_version` | POST   | 已支持 | 基于指定 indexing prompt 版本后台重建                        |
| `/documents/scan`                          | POST   | 已支持 | 扫描输入目录中的新文件                                       |
| `/documents/upload`                        | POST   | 已支持 | 上传文件并后台建库                                           |
| `/documents/text`                          | POST   | 已支持 | 写入单段文本                                                 |
| `/documents/texts`                         | POST   | 已支持 | 批量写入文本                                                 |
| `/documents/import/custom-chunks`          | POST   | 已支持 | 直接导入预切分 chunks，不走后台任务                          |
| `/documents/by-ids`                        | POST   | 已支持 | 按 doc_id 批量查询文档状态                                   |
| `/documents`                               | DELETE | 已支持 | 清空文档及相关存储                                           |
| `/documents/pipeline_status`               | GET    | 已支持 | 查询流水线执行状态                                           |
| `/documents`                               | GET    | 已支持 | 旧接口；已标记为 deprecated，建议使用 `/documents/paginated` |
| `/documents/delete_document`               | DELETE | 已支持 | 按 doc_id 后台删除文档                                       |
| `/documents/clear_cache`                   | POST   | 已支持 | 清空 LLM 缓存                                                |
| `/documents/delete_entity`                 | DELETE | 已支持 | 旧图删除接口，功能仍可用                                     |
| `/documents/delete_relation`               | DELETE | 已支持 | 旧图删除接口，功能仍可用                                     |
| `/documents/track_status/{track_id}`       | GET    | 已支持 | 按 track_id 查询处理状态                                     |
| `/documents/paginated`                     | POST   | 已支持 | 分页获取文档列表                                             |
| `/documents/status_counts`                 | GET    | 已支持 | 文档状态计数                                                 |
| `/documents/reprocess_failed`              | POST   | 已支持 | 重新处理失败或挂起文档                                       |
| `/documents/cancel_pipeline`               | POST   | 已支持 | 请求取消当前流水线                                           |

### 3. 查询

| 路径            | 方法 | 状态   | 备注                                 |
| --------------- | ---- | ------ | ------------------------------------ |
| `/query`        | POST | 已支持 | 非流式问答接口                       |
| `/query/stream` | POST | 已支持 | NDJSON 流式问答接口                  |
| `/query/data`   | POST | 已支持 | 只返回结构化检索结果，不做 LLM 生成  |
| `/query/raw`    | POST | 已支持 | 返回完整非流式 `aquery_llm` 结果结构 |

查询模式当前支持：

- `local`
- `global`
- `hybrid`
- `naive`
- `mix`
- `bypass`

附加约束：

| 能力               | 状态     | 备注                                                                         |
| ------------------ | -------- | ---------------------------------------------------------------------------- |
| `prompt_overrides` | 部分支持 | 若服务端禁用该能力则返回 403；在 `bypass` 模式下返回 400                     |
| 引用内容回传       | 已支持   | `/query` 与 `/query/stream` 支持返回 references，且可附带 chunk content      |
| 结构化数据回传     | 已支持   | `/query/data` 始终返回 entities、relationships、chunks、references、metadata |

### 4. 图谱

| 路径                       | 方法   | 状态     | 备注                                              |
| -------------------------- | ------ | -------- | ------------------------------------------------- |
| `/graph/label/list`        | GET    | 已支持   | 获取图标签列表                                    |
| `/graph/entity-type/list`  | GET    | 已支持   | 获取实体类型列表                                  |
| `/graph/label/popular`     | GET    | 已支持   | 获取热门标签                                      |
| `/graph/label/search`      | GET    | 已支持   | 模糊搜索标签                                      |
| `/graphs`                  | GET    | 已支持   | 旧版子图接口                                      |
| `/graph/query`             | POST   | 已支持   | 结构化图查询接口                                  |
| `/graph/entity`            | DELETE | 已支持   | 删除实体                                          |
| `/graph/relation`          | DELETE | 已支持   | 删除关系                                          |
| `/graph/merge/suggestions` | POST   | 部分支持 | 若后端未实现 `aget_merge_suggestions`，会返回 501 |
| `/graph/entity/exists`     | GET    | 已支持   | 判断实体是否存在                                  |
| `/graph/entity/edit`       | POST   | 已支持   | 编辑实体，支持 revision token                     |
| `/graph/relation/edit`     | POST   | 已支持   | 编辑关系，支持 revision token                     |
| `/graph/entity/create`     | POST   | 已支持   | 创建实体                                          |
| `/graph/relation/create`   | POST   | 已支持   | 创建关系                                          |
| `/graph/entities/merge`    | POST   | 已支持   | 合并多个实体                                      |
| `/graph/import/custom-kg`  | POST   | 已支持   | 直接导入结构化知识图谱 payload                    |
| `/graph/entity/detail`     | GET    | 已支持   | 查询实体详情，可选返回 vector data                |
| `/graph/relation/detail`   | GET    | 已支持   | 查询关系详情，可选返回 vector data                |
| `/graph/export`            | POST   | 已支持   | 导出图数据并以下载文件形式返回                    |

### 5. Prompt 版本管理

Prompt 版本管理统一挂载在 `/prompt-config` 前缀下。

| 路径                                                         | 方法   | 状态   | 备注                            |
| ------------------------------------------------------------ | ------ | ------ | ------------------------------- |
| `/prompt-config/initialize`                                  | POST   | 已支持 | 初始化默认 prompt 版本组        |
| `/prompt-config/groups`                                      | GET    | 已支持 | 列出 indexing 与 retrieval 分组 |
| `/prompt-config/{group_type}/versions`                       | GET    | 已支持 | 版本列表                        |
| `/prompt-config/{group_type}/versions/{version_id}`          | GET    | 已支持 | 版本详情                        |
| `/prompt-config/{group_type}/versions`                       | POST   | 已支持 | 创建版本                        |
| `/prompt-config/{group_type}/versions/{version_id}`          | PATCH  | 已支持 | 更新版本                        |
| `/prompt-config/{group_type}/versions/{version_id}/activate` | POST   | 已支持 | 激活版本                        |
| `/prompt-config/{group_type}/versions/{version_id}`          | DELETE | 已支持 | 删除版本                        |
| `/prompt-config/{group_type}/versions/{version_id}/diff`     | GET    | 已支持 | 版本差异                        |

### 6. Workspace 管理

Workspace 路由统一挂载在 `/workspaces` 前缀下。

| 路径                                  | 方法 | 状态     | 备注                                  |
| ------------------------------------- | ---- | -------- | ------------------------------------- |
| `/workspaces`                         | GET  | 已支持   | 列出当前可见 workspace                |
| `/workspaces`                         | POST | 已支持   | 创建 workspace                        |
| `/workspaces/{workspace}`             | GET  | 已支持   | 获取 workspace 详情                   |
| `/workspaces/{workspace}/stats`       | GET  | 部分支持 | 若未配置 `stats_provider`，会返回 501 |
| `/workspaces/{workspace}/soft-delete` | POST | 已支持   | 软删除                                |
| `/workspaces/{workspace}/restore`     | POST | 已支持   | 恢复                                  |
| `/workspaces/{workspace}/hard-delete` | POST | 已支持   | 异步硬删除，返回 202                  |
| `/workspaces/{workspace}/operation`   | GET  | 已支持   | 查询异步操作状态                      |

### 7. Ollama 兼容接口

Ollama 兼容接口由服务入口以 `/api` 前缀挂载。

| 路径            | 方法 | 状态   | 备注                           |
| --------------- | ---- | ------ | ------------------------------ |
| `/api/version`  | GET  | 已支持 | 返回 Ollama 版本信息           |
| `/api/tags`     | GET  | 已支持 | 返回可用模型列表               |
| `/api/ps`       | GET  | 已支持 | 返回运行中模型                 |
| `/api/generate` | POST | 已支持 | 生成接口；兼容 Ollama generate |
| `/api/chat`     | POST | 已支持 | 聊天接口；兼容 Ollama chat     |

说明：

- 当前兼容层明确是 Ollama 风格接口，而不是 OpenAI 风格接口。
- `/api/chat` 内部会解析查询前缀，如 `/mix`、`/hybrid`、`/bypass`，再映射到 LightRAG 查询模式。

## 未支持或未暴露的能力

下表中的能力在 `LightRAG` 核心类中已经存在，但当前未暴露为对外 HTTP API。

| 核心能力                       | Core 是否存在 | HTTP API 是否存在 | 当前结论       |
| ------------------------------ | ------------- | ----------------- | -------------- |
| `aexport_data` / `export_data` | 是            | 否                | 未支持对外 API |

## 未支持的协议兼容层

| 协议风格             | 状态              | 说明                                                                                     |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| OpenAI 服务端接口    | 未支持            | 未发现 `/v1/chat/completions`、`/v1/embeddings`、`/v1/responses` 等服务端路由            |
| 完整 Ollama 全量协议 | 未确认 / 当前未见 | 目前只实现 `/api/version`、`/api/tags`、`/api/ps`、`/api/generate`、`/api/chat` 五个接口 |

需要区分两件事：

- “支持 openai 或 openai compatible 作为后端绑定”表示 LightRAG 可以把外部 OpenAI 风格模型服务作为上游 LLM 或 Embedding 后端。
- “对外提供 OpenAI 风格服务端 API”表示 LightRAG 自己暴露 `/v1/*` 协议给别的客户端调用。

当前前者已支持，后者未实现。

## 文档与实现差异

### 1. Prompt 更新接口存在文档缺口

公开文档中列出了 prompt 版本管理的大多数路由，但没有把以下接口写入清单：

- `PATCH /prompt-config/{group_type}/versions/{version_id}`

结论：

- 这是文档漏项，不是功能缺失。
- 如果要对外发布完整接口目录，应同步补齐 `README.md` 与 `README-zh.md`。

### 2. 文档中的“兼容”容易被误读

现有文档中“openai compatible”的语义指向上游模型绑定，而不是 LightRAG 对外暴露 OpenAI 服务端协议。为了减少误解，建议在 API 文档中单独增加一节，明确：

- 已实现的协议兼容层：Ollama
- 未实现的协议兼容层：OpenAI `/v1/*`

## 建议新增 API 清单

以下 P1 项已于 2026-03-31 完成：

| 已完成 API                             | 对应核心能力            |
| -------------------------------------- | ----------------------- |
| `POST /graph/import/custom-kg`         | `ainsert_custom_kg`     |
| `POST /documents/import/custom-chunks` | `ainsert_custom_chunks` |
| `POST /documents/by-ids`               | `aget_docs_by_ids`      |
| `GET /graph/entity/detail`             | `get_entity_info`       |
| `GET /graph/relation/detail`           | `get_relation_info`     |

以下仍是后续候选 API。

以下 P2 项已于 2026-03-31 完成：

| 已完成 API           | 对应核心能力   |
| -------------------- | -------------- |
| `POST /graph/export` | `aexport_data` |
| `POST /query/raw`    | `aquery_llm`   |

### 后续候选

| 建议新增 API      | 对应核心能力 | 价值                                                                  |
| ----------------- | ------------ | --------------------------------------------------------------------- |
| `POST /query/llm` | `aquery_llm` | 如果未来需要兼容旧命名或显式 LLM 语义，可作为 `/query/raw` 的别名评估 |

### 暂不建议优先推进

| 候选方向                     | 原因                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| 直接补 OpenAI `/v1/*` 协议层 | 面向客户端兼容性价值高，但工作量和语义边界都明显大于现有缺口               |
| 再扩更多 Ollama 子接口       | 目前 `/api/chat` 和 `/api/generate` 已覆盖主路径，扩展收益要看真实接入场景 |

## 测试证据概览

当前已有明显测试覆盖的 API 面包括：

- 图谱 API
- Prompt 管理 API
- Workspace 管理 API
- Ollama 兼容接口
- 查询接口
- 部分文档接口

代表性测试文件：

- `tests/test_graph_routes.py`
- `tests/test_prompt_config_routes.py`
- `tests/test_workspace_management_routes.py`
- `tests/test_lightrag_ollama_chat.py`
- `tests/test_aquery_data_endpoint.py`
- `tests/test_document_rebuild_route.py`

当前没有直接证据表明以下仍未暴露能力已经有面向 HTTP API 的测试：

- `aexport_data`

## 建议后续动作

如果要把这份梳理继续推进成可执行任务，建议按下面顺序做：

1. 先补文档缺口：把 prompt 更新接口和 2026-03-31 新增 API 补进 `docs/LightRAG-API-Server.md` 与 `docs/LightRAG-API-Server-zh.md`。
2. 评估是否还需要 `/query/llm` 别名，或保持 `query/raw` 作为唯一完整结果接口。
3. 如果要拓展客户端生态，再评估是否引入 OpenAI `/v1/*` 兼容层。

## 证据来源

本次梳理主要来自以下代码与文档位置：

- `lightrag/api/lightrag_server.py`
- `lightrag/api/routers/document_routes.py`
- `lightrag/api/routers/query_routes.py`
- `lightrag/api/routers/graph_routes.py`
- `lightrag/api/routers/prompt_config_routes.py`
- `lightrag/api/routers/workspace_routes.py`
- `lightrag/api/routers/ollama_api.py`
- `lightrag/lightrag.py`
- `docs/LightRAG-API-Server.md`
- `lightrag/api/README-zh.md`
- `tests/test_graph_routes.py`
- `tests/test_prompt_config_routes.py`
- `tests/test_workspace_management_routes.py`
- `tests/test_lightrag_ollama_chat.py`
- `tests/test_aquery_data_endpoint.py`
