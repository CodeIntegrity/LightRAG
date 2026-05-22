# 上游代码合并功能文档

> 基于 `3d9e5df2 merge(upstream): merge upstream/main with prompt management retired`
> 上游基线: `HKUDS/LightRAG@b62c2606` (2026-05-21)
> 文档生成: 2026-05-22

---

## 目录

1. [自定义实体提示词（重点）](#1-自定义实体提示词重点)
2. [文件处理管线 (File Processing Pipeline)](#2-文件处理管线)
3. [LLM 角色化配置 (`llm_roles.py`)](#3-llm-角色化配置)
4. [解析器生态扩展](#4-解析器生态扩展)
5. [分块器 (Chunker) 扩展](#5-分块器扩展)
6. [多模态与 Sidecar 体系](#6-多模态与-sidecar-体系)
7. [存储层优化与修复](#7-存储层优化与修复)
8. [API 服务端增强](#8-api-服务端增强)
9. [运维与配置优化](#9-运维与配置优化)
10. [Bug 修复列表](#10-bug-修复列表)

---

## 1. 自定义实体提示词（重点）

### 1.1 提示词 Profile / 文件型定制

**上游引入了一种基于 YAML 文件的实体提取提示词定制机制，替代了硬编码的 entity_types 和内联示例。**

核心文件：
- `prompts/UserCustomizePrompts.md` — 用户自定义提示词目录说明
- `prompts/samples/entity_type_prompt.sample.yml` — **实体类型提示词模板的完整示例**

### 1.2 `prompts/samples/entity_type_prompt.sample.yml` 结构

该 YAML 文件支撑以下四个 session 的定制：

| Session Key | 作用 | 示例内容 |
|---|---|---|
| `entity_types_guidance` | 定义所有实体类型及其描述 | Person, Organization, Location, Method, Concept 等 11 种类型定义 |
| `entity_extraction_examples` | 非 JSON 模式下 few-shot 示例 | 3 组完整的 Input→Output 示例（文学、生态、AI 论文场景） |
| `entity_extraction_json_examples` | JSON 模式下的 few-shot 示例 | 同上 3 组场景的 JSON 格式示例 |

**关键改进：**

1. **实体类型从硬编码的枚举列表变为带详细描述的 guidance 文本**
   - 旧: `["Person","Creature","Organization",...]`
   - 新: `Person: Human individuals, real or fictional` 等含描述的类型指引
   - LLM 不再只看分类名，而是理解每个类型的语义范围

2. **示例从内嵌 Python 代码块迁移到可独立编辑的 YAML 文件**
   - 用户不需要修改 Python 源码，只需复制 `samples/entity_type_prompt.sample.yml` 到 `prompts/` 目录并编辑
   - 支持添加/删除实体类型、调整 few-shot 示例、自定义 guidance

3. **JSON 模式专有提示词 (`entity_extraction_json_system_prompt`)**
   - 新增 `PROMPTS["entity_extraction_json_system_prompt"]` — JSON 结构化输出的专用 system prompt
   - 新增 `PROMPTS["entity_extraction_json_user_prompt"]` — JSON 模式的用户提示词
   - 新增 `PROMPTS["entity_continue_extraction_json_user_prompt"]` — JSON 模式续提取提示词
   - 新增 `PROMPTS["entity_extraction_json_examples"]` — JSON 模式专用 few-shot 示例
   - **JSON 模式配合 `ENTITY_EXTRACTION_USE_JSON` 环境变量可实现更高质量的实体提取**

4. **提示词格式精细化**
   - 使用 `---Entity Types---` / `---Input Text---` / `---Output---` 的 markdown 分节标记，替代旧的 XML 风格 `<Entity_types>` / `<Input Text>`
   - 移除 `---Data to be Processed---` 外壳，直接进入 `---Input Text---`
   - `entity_type` 首字母大写（如 `Person` 而非 `person`），提升一致性

### 1.3 Prompt 解析与模板变量

上游 `lightrag/prompt.py` 的 Prompt Profile 机制支持以下变量拼接：

```
{entity_types_guidance}    — 实体类型指导文本
{examples}                 — few-shot 示例
{input_text}               — 待提取的文本
{language}                 — 输出语言（从 env 读 LIGHTRAG_DEFAULT_LANGUAGE）
{max_total_records}        — 最大输出记录数
{max_entity_records}       — 最大实体输出数
{tuple_delimiter}          — 分隔符
{completion_delimiter}     — 完成信号
```

### 1.4 续提取（Gleaning）提示词改进

续提取流程使用独立的 `entity_continue_extraction_user_prompt` / `entity_continue_extraction_json_user_prompt`：
- 上游明确：续提取最多输出 `{max_total_records}` 行 / `{max_entity_records}` 个 entity
- 关系行可以引用前一次已正确提取的实体，无需重复输出那些实体
- JSON 模式空输出规范：`{"entities": [], "relationships": []}`

### 1.5 实体提取量限控制（Max Extract Input Tokens）

**新增 `MAX_EXTRACT_INPUT_TOKENS` 环境变量**（默认值从代码看为 120000），在 analyze 和 gleaning 阶段强制限制输入 token 数量，防止超大文档导致 token 溢出。

相关提交: `36f23ed2 feat(extract): enforce MAX_EXTRACT_INPUT_TOKENS for analyze & gleaning`

### 1.6 关键词提取提示词收紧

关键词提取 prompt 新增三个约束：
1. **Exact JSON Shape**: 严格要求 JSON 仅含 `high_level_keywords` 和 `low_level_keywords`
2. **JSON Boundary**: 首字符必须为 `{`，末字符必须为 `}`
3. **Source of Truth 收紧**: "Do not infer unsupported facts. Do not invent entities, products, organizations, dates, or technical terms that are not grounded in the query."

这减少了 LLM 在关键词提取阶段的幻觉和格式偏差。

### 1.7 `addon_params.py` — 可观察的附加参数

新增 `ObservableAddonParams` 数据类，作为可观察的附加参数容器。配合 `_refresh_addon_params_cache` 和 `addon_params` 属性，支持 runtime 更新 prompt profile 选择参数。

---

## 2. 文件处理管线 (File Processing Pipeline)

**上游新增了一个完整的文档处理管线系统**（`lightrag/pipeline.py`，4486 行新增），支持：
- 文档入队 (`apipeline_enqueue_documents`)
- 处理队列 (`apipeline_process_enqueue_documents`)
- 错误处理 (`apipeline_process_error_documents`)
- 管线状态管理与并发契约

### 2.1 Pipeline 并发契约

引入 `pipeline_status` 共享状态，包含以下字段：
- `busy` — 通用忙碌标志
- `destructive_busy` — 破坏性操作（clear/delete）的独占锁
- `scanning` / `scanning_exclusive` — 扫描操作锁
- `pending_enqueues` — 排队中的上传计数
- `request_pending` — 处理循环重查询信号

**关键规则**：允许 enqueue 和 processing 并发进行，但禁止 enqueue 与 destructive/scanner exclusive 并发。

### 2.2 Pipeline Status 刷新

新增 `pipeline-status` 端点：poe + throttled refresh 机制，前端可轮询获取管线状态实时反馈。

### 2.3 文档去重增强

- 跨文件名的 content hash 去重：相同内容不同文件名不再重复入库
- 统一 content hash 计算方法，覆盖 raw 和 lightrag 两种格式
- 新增 `normalize_file_path` 辅助函数

### 2.4 Per-Document I/O 失败处理

`lightrag` 格式的文档在 I/O 失败时不会让整个批次崩溃，而是逐文档降级。

---

## 3. LLM 角色化配置 (`lightrag/llm_roles.py`)

### 3.1 核心架构

引入 `_RoleLLMMixin` 作为 `LightRAG` 的 Mixin 层，支持为不同任务阶段分配独立的 LLM 绑定：

| Role | 键名 | 用途 |
|---|---|---|
| `extract` | `EXTRACT` | 实体/关系提取 |
| `keyword` | `KEYWORD` | 关键词提取 |
| `query` | `QUERY` | 查询推理 |
| `vlm` | `VLM` | 视觉语言模型 |

### 3.2 配置方式

**环境变量**（推荐）:
```bash
EXTRACT_LLM_BINDING=openai    # 提取使用 OpenAI
EXTRACT_LLM_MODEL=gpt-4o      # 提取使用 gpt-4o
EXTRACT_MAX_ASYNC_LLM=8       # 提取并发数
QUERY_LLM_BINDING=anthropic   # 查询使用 Anthropic（跨供应商）
QUERY_LLM_MODEL=claude-opus   # 查询使用 Claude
```

**代码级配置**:
```python
from lightrag.llm_roles import RoleLLMConfig

rag = LightRAG(
    llm_model_func=base_llm,
    role_llm_configs={
        "extract": RoleLLMConfig(max_async=8),
        "query": RoleLLMConfig(func=custom_query_llm),
    }
)
```

### 3.3 Runtime 热更新

支持通过 `update_llm_role_config` / `aupdate_llm_role_config` 在运行时动态切换 LLM 绑定，无需重启服务。包括异步变体等待旧队列优雅退出。

### 3.4 跨供应商角色支持

metadata 中的 `is_cross_provider` 标志可自动检测角色是否跨越了 LLM 供应商。当切换 binding 时，角色 builder 自动重建 LLM 函数并更新 kwargs。

### 3.5 安全：密钥脱敏

`get_llm_role_config()` 返回的角色配置自动脱敏 api_key、access_key、secret、token 等认证字段，确保 `/health` 和 WebUI 不泄露凭据。

---

## 4. 解析器生态扩展

### 4.1 解析器路由 (`lightrag/parser_routing.py`)

新增 896 行的解析器路由模块，统一管理：
- 文件名提示 (hint) 验证与解析引擎选择
- chunker 配置解析
- 支持的引擎：`legacy` / `native` / `mineru` / `docling`

### 4.2 原生 DOCX 解析器 (`lightrag/native_parser/docx/`)

上游新增了完整的原生 DOCX 解析管线（~4250 行代码），包含：
- **`ir_builder.py`**: DOCX → IR (Intermediate Representation) 的转换器
- **`drawing_image_extractor.py`**: 图表/图片提取
- **`table_extractor.py`**: 表格提取
- **`numbering_resolver.py`**: 编号/列表解析
- **`omml/`**: Office Math Markup Language 公式解析器
- **`utils.py`**: 辅助函数（路径安全、XML 解析等）
- **安全修复**: 图片路径拒绝路径遍历，外部链接 image 保留但不过滤

### 4.3 MinerU 解析器 (`lightrag/external_parser/mineru/`)

- **`client.py`**: 异步 HTTP 客户端，支持 MinerU 精密 API v4
- **`ir_builder.py`**: MinerU 输出 → IR 的适配器
- **`cache.py`**: 原始输出缓存 + 选项签名校验
- **`manifest.py`**: 解析清单管理
- **增强**:
  - 段落标题合并 (`split-by-heading` 策略)
  - 内容项 self_ref 追踪
  - 页面级位置发射 (`page_idx` → page-level positions)
  - 流式上传替代同步文件读取（httpx 0.28+ 兼容）
  - 文件名 parser hints 剥离 (`upload_name` 参数)

### 4.4 Docling 解析器 (`lightrag/external_parser/docling/`)

- **`client.py`**: 异步 multipart 上传客户端
- **`ir_builder.py`**: Docling JSON → IR 的转换器
- **`cache.py`**: 侧车缓存管理
- **`manifest.py`**: 输出清单
- **修复**:
  - async multipart upload 兼容 httpx ≥ 0.28
  - 快速轮询死循环修复 (server ignores wait parameter)
  - 防止图片 URI 路径遍历
  - 默认 `DOCLING_FORCE_OCR=true`（不再默认关闭）
  - 大文档 OOM 修复
  - 家具文本不泄露到 sidecar 元数据

### 4.5 解析器 CLI (`lightrag/parser_cli.py` / `lightrag/parser_debug.py`)

新增统一解析器调试 CLI，支持：
- 文件后缀与引擎匹配的早期校验
- 解析进度日志（MinerU / Docling）
- 单文件调试模式

---

## 5. 分块器 (Chunker) 扩展

上游新增 4 种分块策略模块：

### 5.1 段落语义分块 (`paragraph_semantic.py`, 1503 行)
- 基于段落语义的分块策略
- 支持长段落分割、表格分割
- 语义合并与 fallback 机制

### 5.2 递归字符分块 (`recursive_character.py`, 110 行)
- 基于字符分隔符的递归分割

### 5.3 语义向量分块 (`semantic_vector.py`, 217 行)
- 基于 embedding 相似度边界检测的分块

### 5.4 Token 数量分块 (`token_size.py`, 128 行)
- 基于 token 计数的简单截断分块

### 5.5 P 策略专属默认值

chunker `P` 策略新增专属 `chunk_token_size` 默认值，不再与其它策略共享参数。

### 5.6 Chunk 选项持久化 (`test_chunk_options_persistence.py`, 1291 行测试)

新增 `chunk_schema.py` 定义分块选项的结构化 schema。

---

## 6. 多模态与 Sidecar 体系

### 6.1 Sidecar 基础设施 (`lightrag/sidecar/`)

统一的多模态 Sidecar 格式：
- **`ir.py`**: Intermediate Representation (IR) 数据类定义
- **`writer.py`**: Sidecar 写入器，管理多模态工件的文件系统输出
- **`placeholders.py`**: 占位符解析与替换

### 6.2 多模态上下文 (`lightrag/multimodal_context.py`, 1028 行)

多模态上下文处理核心：
- 图片渲染逻辑统一为 `bracket-label` 内联格式
- 多模态实体名称生成简化
- 多模态 surrounding context 处理
- 多模态内容截断策略

### 6.3 VLM 支持 (`lightrag/llm/_vision_utils.py`, 301 行)

视觉语言模型工具函数，支持图片负载、VLM 缓存键、VLM 图片输入处理。

### 6.4 多模态 Prompt (`lightrag/prompt_multimodal.py`, 322 行)

多模态专用的提示词模板。

### 6.5 关键修复

- `analyze_multimodal` 改为每次重新计算启用的模态（不再缓存过期的判定）
- DOCX 图片前缀 `dr-` → `im-` 的统一重命名
- MinerU/Docling 空表格丢弃，防止 analyze worker 硬失败

---

## 7. 存储层优化与修复

### 7.1 PostgreSQL 存储

- 对齐 fields 与 JSON 存储保持一致性
- 移除重复的 partial index 创建
- 改进 schema 弹性 + partial upsert 语义
- 新增 `basename` / `content_hash` 查找

### 7.2 Redis 存储

- 新增 `basename` 和 `content_hash` 为基础的 doc status 查找

### 7.3 OpenSearch 存储

- 新增 `basename` 和 `content_hash` 查找

### 7.4 MongoDB 存储

- doc-status storage 对齐 JSON 存储 parity
- 新增 pymongo 错误处理测试

### 7.5 DocStatus 存储抽象化

`ac025b1c refactor(doc-status-storage)`: DocStatusStorage 中的具体方法转为抽象方法，提升后端一致性。

### 7.6 文件路径归一化

文件路径归一化从各存储层收敛到业务层统一处理（`12d67289`）。

### 7.7 存储工厂优化

`6ef5423d`: `lazy_external_import` 替换为标准 `importlib`，简化依赖管理。

---

## 8. API 服务端增强

### 8.1 Role LLM 配置端点

API 服务器新增 role LLM 配置的读取与运行时更新支持。

### 8.2 VLM 配置

新增 `VLM_PROCESS_ENABLE` 配置开关和相关 API 配置项。

### 8.3 Embedding Timeout

新增 `EMBEDDING_TIMEOUT` 配置项。

### 8.4 存储 Workspaces

API 层面新增 `storage_workspaces` 概念，与上游存储级 workspace 对应。

### 8.5 Pipeline Status 端点

新增 `pipeline_busy` 和 `pipeline_scanning` 状态暴露。

---

## 9. 运维与配置优化

### 9.1 环境配置

- `env.example` 大幅更新（548 行变更）：
  - 新增 parser 配置节
  - 新增 docling/mineru 配置项
  - 新增 role LLM 配置（EXTRACT/KEYWORD/QUERY/VLM）
  - 新增 pipeline 并发默认值
  - 新增 VLM 开关
  - 新增 MAX_EXTRACT_INPUT_TOKENS
  - 新增 embedding_timeout

### 9.2 Docker 配置

- 新增 prompts 目录的 Docker 挂载配置
- Memgraph 端口注释掉（安全暴露控制）
- Redis URI 尾部默认斜杠清理

### 9.3 .gitignore 更新

- prompts 目录、prompts 相关的 ignore 规则更新

### 9.4 日志统一

管线日志消息统一，chunking 日志消息使用 `doc_id` 替代泛化信息。

---

## 10. Bug 修复列表

| 提交 | 修复内容 |
|---|---|
| `d4be4f85` | `analyze_multimodal` 每次重新计算启用模态（不再缓存过期） |
| `8d5509ae` | 解析重试时清除 stale per-attempt fields |
| `acef76c2` | Docling 默认选项缓存失效修复 |
| `5369a908` | MinerU 丢弃空表格，防止 analyze worker hard-failure |
| `6fb0b51a` | Docling 丢弃空表格，防止 analyze worker failures |
| `5368069a` | 缓存选项签名验证使用当前固定常量 |
| `b9e7d395` | Docling 防止图片 URI 路径遍历 |
| `28900775` | Docling 大文档解析 OOM 修复 |
| `e6ef3938` | Docling 家具文本不泄露到 sidecar 元数据 |
| `da709838` | Docling async multipart upload 兼容 httpx >= 0.28 |
| `8a6a04bc` | Docling 修复 server ignores wait 导致的快速轮询死循环 |
| `d34dbdac` | 修复 LLM choices 为空时的 IndexError |
| `957145ba` | 扩展 choices guard 也检查 message 是否为 None |
| `fde8539b` | Tokenizer.encode 优雅处理 disallowed special tokens |
| `ed09c281` | PostgreSQL 移除重复 partial index 创建 |
| `24632a7d` | 解析器 options-only filename hint 强制前导连字符 |
| `5279aa8d` | 解析 workspace-scoped 输入文件路径 |
| `87412599` | Sidecar 孤儿子项和坏 bbox JSON 的告警处理 |
| `85b186dc` | MinerU 图片路径拒绝路径遍历 |
| `38f68768` | DOCX 图片资源路径解析安全检查 |

---

## A. Prompt 退役说明

本次合并中，本地二开的 **Prompt Management WebUI / API / 版本库** 已退役（详见 `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`）：

**删除的本地能力：**
- `lightrag/api/routers/prompt_config_routes.py` — Prompt 配置 REST API
- `lightrag/prompt_version_store.py` — Prompt 版本存储
- `lightrag/prompt_versions.py` — Prompt 版本模型
- `lightrag_webui/src/features/PromptManagement.tsx` — Prompt 管理页面
- `lightrag_webui/src/components/prompt-management/*` — Prompt 管理组件
- `lightrag_webui/src/components/retrieval/PromptOverridesEditor.tsx` — Prompt 覆盖编辑器
- `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.tsx` — 版本选择器

**保留/回归上游的能力：**
- `lightrag/prompt.py` — 上游 prompt profile 解析
- `prompts/UserCustomizePrompts.md` — 文件型定制入口
- `prompts/samples/entity_type_prompt.sample.yml` — 实体类型提示词模板
- `lightrag/llm_roles.py` — 角色化 LLM 配置

**API 契约变更：**
- `prompt_overrides` / `allow_prompt_overrides_via_api` / `active_prompt_versions` 已从 API 中删除
- Dify OpenAPI schema 已同步移除 `prompt_overrides` 字段
- 前端不再展示 Prompt Management tab

**迁移指引：** 使用 `prompts/samples/entity_type_prompt.sample.yml` 作为模板，在 `prompts/` 目录下创建自定义实体类型提示词文件，通过环境变量指定 profile。
