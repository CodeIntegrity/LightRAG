# Goal

为前端 `Prompts/提示词` 页面增加“LLM 辅助编写提示词”能力：用户输入个性化要求，后端复用当前 LightRAG runtime 已配置的 LLM，结合系统内置实体抽取提示词基线和当前编辑内容，生成可编辑的 YAML 提示词草稿。首版只生成建议，不自动保存、不自动启用，用户必须手动审阅、校验、保存。

# Architecture

- 新能力归属现有 workspace prompt editor，不恢复已退役的本地 Prompt Management 版本库。
- 后端在 `lightrag/api/routers/prompt_routes.py` 下新增辅助生成接口，复用 `/prompts/entity-type/*` 同一认证、workspace 和校验边界。
- LLM 调用优先使用 `rag.role_llm_funcs.get("query")`，回落到 `rag.llm_model_func`；不挂 `hashing_kv`/`llm_response_cache`（首版不缓存：输入易变、缓存价值低且会污染 extract cache 命名空间）。
- 调用强制 `stream=False`，且对返回值做 `isinstance(res, str)` 检查；若非 str（部分 provider 仍返回 async iterator），统一报 500 并写日志，避免泄漏 provider 细节。
- 辅助生成输入只接受：用户要求、当前编辑 YAML、可选生成语言。后端自行注入系统内置 prompt profile、当前 active prompt profile 和 YAML 输出约束。`use_json` 保留为 API 可选字段（默认跟随 runtime `entity_extraction_use_json`），但前端 UI **不暴露** —— 避免给用户造成认知负担。
- `current_content` 不混入用户 requirements，必须用 `<current_yaml>...</current_yaml>` 标签隔离，明确 LLM 角色：requirements 是"修改诉求"，current_content 是"待修改基线"。
- 辅助生成输出返回：草稿内容、校验结果、说明性 warnings、`raw_output`（LLM 原始返回，用于"生成成功但校验失败"时的前端调试展示）。前端把结果展示为可预览草稿，用户点击"应用草稿"后才覆盖编辑器内容。
- 生成后立即复用现有 `_validate_content()` 校验，防止无效 YAML 或缺少必需字段的内容直接进入编辑器保存链路。

# Tech Stack

- 后端：FastAPI、Pydantic、现有 `prompt_routes.py`、`lightrag.prompt` profile loader/validator、当前 workspace 的 `LightRAG` runtime LLM。
- 前端：React 19、TypeScript、Bun、Vite、Tailwind、现有 `Prompts.tsx`、`YamlEditor`、`sonner` toast、i18next locale 文件。
- 测试：`./scripts/test.sh`、`ruff check`、`bun test`、`bun run build`。

# Baseline/Authority Refs

- `docs/aegis/plans/2026-05-23-workspace-prompt-editor.md`
  - 当前 Prompts 页面已围绕 workspace 文件型 prompt 实现。
  - 明确禁止恢复数据库化 Prompt Management 版本库。
- `lightrag/api/routers/prompt_routes.py`
  - 已有 `PromptValidateRequest`、`PromptSaveRequest`、`PromptReadResponse` 等模型。
  - `_validate_content()` 是保存/启用前的 canonical 校验入口。
  - `_activate_prompt()` 只更新当前 workspace runtime 的 `addon_params["entity_type_prompt_file"]`。
- `lightrag/prompt.py`
  - `get_default_entity_extraction_prompt_profile()` 提供系统默认实体抽取 profile。
  - `validate_entity_extraction_prompt_profile_for_mode()` 定义 text/json 模式校验要求。
- `lightrag_webui/src/pages/Prompts.tsx`
  - 当前页面负责列表、读取、编辑、校验、保存、启用、停用。
- `lightrag_webui/src/api/lightrag.ts`
  - prompt API client 已经有测试注入点 `__setPromptHttpClientForTests()`。
  - axios interceptor 已自动携带 `LIGHTRAG-WORKSPACE`。
- `lightrag_webui/src/locales/{en,zh,ja}.json`
  - Prompts 文案集中在 `prompts` namespace。

# Compatibility Boundary

必须保持：

- 现有提示词文件格式仍是 YAML profile，不新增数据库 owner。
- 现有列表、读取、校验、保存、启用 API 行为不变。
- 现有 `PROMPT_DIR/entity_type`、`ENTITY_TYPE_PROMPT_FILE`、`addon_params["entity_type_prompt_file"]` 语义不变。
- 辅助生成接口不落盘，不改变 active prompt。
- 没有可用 LLM 时返回 503 Service Unavailable；LLM 调用异常（连接失败、鉴权失败、超时等）统一映射为 502 Bad Gateway，不暴露 provider 错误细节。两者都不影响手动编辑功能。

允许新增：

- `POST /prompts/entity-type/assist` 或同等命名的辅助生成 endpoint。
- 前端 Prompts 页面中的辅助编写面板、弹窗或侧栏。
- API client 类型、i18n 文案、测试。

禁止新增：

- 新 LLM provider 配置。
- 前端直接调用外部 LLM。
- LLM 输出自动保存、自动启用或绕过 `_validate_content()`。
- 把用户要求或当前提示词写入长期日志、缓存 key 明文文档或持久配置。

# Verification

后端：

```bash
ruff check lightrag/api/routers/prompt_routes.py tests/test_workspace_prompt_routes.py
./scripts/test.sh tests/test_workspace_prompt_routes.py -q
```

前端：

```bash
cd lightrag_webui
bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx
bun run lint
bun run build
```

手工最小验证：

1. 启动 API 和 WebUI。
2. 打开 Prompts 页面，在辅助编写输入框中填写“为医疗文档抽取疾病、药品、症状、检查和治疗关系”。
3. 点击生成，确认页面出现 YAML 草稿但编辑器未被自动覆盖。
4. 点击应用草稿，确认编辑器内容变化，随后点击校验通过。
5. 保存为新版本并启用，确认 active 文件仍走现有 workspace prompt 机制。
6. 临时移除/禁用 LLM 配置，确认辅助生成报错但手动编辑、校验、保存仍可用。

# Plan Basis

## Facts

- 当前 Prompts 页面已能编辑实体抽取 YAML profile。
- 当前后端 prompt route 已有 workspace、auth、validate、save、activate 边界。
- 当前 LightRAG runtime 已有 `llm_model_func`，各 provider 都接受 `prompt` / `system_prompt` / `history_messages` / `**kwargs` 形态。
- 当前前端 prompt API client 已有单测覆盖路径和编码。

## Assumptions

- 首版只支持实体抽取 prompt profile，不扩展 query prompt、keyword prompt 或 rerank prompt。
- LLM 辅助编写可以返回完整 YAML，而不是增量 patch。
- 生成语言默认跟随 UI locale；后端仍允许显式传 `language`，只影响说明文字和实体类型描述语言。
- 当前 runtime LLM 足够用于短提示词生成；无需额外队列或后台任务。

## Unknowns

- 不同 provider 的结构化输出能力不一致；首版应使用纯文本 YAML 约束并做后端解析校验，不依赖 JSON mode。
- 不同 provider 即使传 `stream=False` 也可能返回 async iterator；首版统一报 500，不做聚合（避免吞掉 provider 异常）。
- 如果 LLM 返回 markdown fence，需要后端清理或拒绝；实施时需用测试固定。
- 大型当前提示词可能占用较多上下文；首版应限制 `current_content` 长度，超长由 Pydantic `max_length` 抛 422。
- 是否需要进程内简单节流（防止前端误触发刷屏 LLM 调用）？首版**不做**，等观测到滥用再加；记录此决定避免后续遗忘。

# File Map

## Modify

- `lightrag/api/routers/prompt_routes.py`
  - 新增 assist request/response Pydantic 模型。
  - 新增 `POST /prompts/entity-type/assist`。
  - 新增内部 helper：构造系统 prompt、调用 runtime LLM、清理 YAML fence、校验草稿。
- `tests/test_workspace_prompt_routes.py`
  - 增加后端 endpoint 测试：成功生成、无 LLM、LLM 输出无效 YAML、请求字段限制。
- `lightrag_webui/src/api/lightrag.ts`
  - 新增 request/response 类型和 `assistEntityTypePrompt()`。
- `lightrag_webui/src/api/lightrag.prompts.test.ts`
  - 覆盖 API client 路径和 payload。
- `lightrag_webui/src/pages/Prompts.tsx`
  - 新增辅助编写 UI 状态、调用、预览、应用草稿动作。
- `lightrag_webui/src/pages/Prompts.test.tsx`
  - 增加页面状态/渲染测试，覆盖辅助生成后不自动覆盖、应用后才覆盖。
- `lightrag_webui/src/locales/en.json`
- `lightrag_webui/src/locales/zh.json`
- `lightrag_webui/src/locales/zh_TW.json`
- `lightrag_webui/src/locales/ja.json`
- `lightrag_webui/src/locales/ko.json`
- `lightrag_webui/src/locales/fr.json`
- `lightrag_webui/src/locales/de.json`
- `lightrag_webui/src/locales/ru.json`
- `lightrag_webui/src/locales/uk.json`
- `lightrag_webui/src/locales/vi.json`
- `lightrag_webui/src/locales/ar.json`
  - 增加 `prompts.assist*` 文案；非中英日语种可直接落英文兜底，但 key 必须存在，避免运行时回退到 raw key。

## Optional Docs

- `docs/LightRAG-API-Server.md`
- `docs/LightRAG-API-Server-zh.md`
  - 若项目要求 API 文档同步，则记录 `POST /prompts/entity-type/assist` 请求/响应。

# API Contract Draft

## Request

`POST /prompts/entity-type/assist`

子路径采用动词式命名（`assist`），与现有 `validate` / `activate` / `deactivate` 保持一致；不走 `PUT /{prompt_slug}/versions/{version}` 形态，因为辅助生成不创建资源。

```json
{
  "requirements": "请为医疗文档生成实体类型和抽取示例",
  "current_content": "entity_types_guidance: ...",
  "language": "zh"
}
```

字段约束：

- `requirements`: 必填，非空，建议 `max_length=4000`。超长由 Pydantic 抛 422。
- `current_content`: 可选，当前编辑器内容，建议 `max_length=30000`。超长由 Pydantic 抛 422。
- `language`: 可选，默认 `"auto"`，允许 `"auto" | "en" | "zh" | "ja"`。
- `use_json`: API 保留为可选字段，缺省使用当前 runtime 的 `entity_extraction_use_json`；前端 UI **不暴露**，避免给用户造成认知负担。

## Response

```json
{
  "content": "entity_types_guidance: ...",
  "validation": { "valid": true, "errors": [] },
  "warnings": [],
  "raw_output": "...LLM 原始返回 (用于调试/前端展示) ...",
  "model": "current-runtime-model-name"
}
```

`raw_output` 字段：保留 LLM 未经 YAML fence 清理的原始返回，便于"生成成功但 `_validate_content()` 失败"场景下前端把原始内容展示给用户调试，避免用户只看到"应用失败"一头雾水。

# Ripple Signal Triage

- Owner 扩展：是。后端 prompt route 增加 LLM 生成职责，但仍归属 prompt route，不新增独立服务。
- Downstream 扩展：是。前端 API client、Prompts 页面和 locale 需要同步。
- Contract 扩展：是。新增公开 API，需要后端和前端测试覆盖。
- Source-of-truth：不变。保存后的提示词仍以 YAML 文件和 `addon_params["entity_type_prompt_file"]` 为准。
- Verification 扩展：需要后端 route 测试 + 前端 API/page 测试 + build。

# ADR Signals

本计划不建议新增 ADR。理由：该能力复用现有 prompt route 和 runtime LLM，未引入新存储 owner、新 provider owner 或新的持久化 source-of-truth。若实施中决定新增独立 prompt-assistant 服务、持久化生成历史或跨 runtime 广播，则需要补 ADR。

# Tasks

## Task 1: 后端模型与失败测试

Files:

- Modify: `lightrag/api/routers/prompt_routes.py`
- Modify: `tests/test_workspace_prompt_routes.py`

Why:

先固定 API 契约，确保辅助生成不落盘、不绕过校验、不要求新 LLM 配置。

Impact/Compatibility:

只新增 endpoint；现有 endpoint 不变。

Steps:

1. Write test
   - 在 `tests/test_workspace_prompt_routes.py` 添加：
     - `test_assist_entity_type_prompt_uses_runtime_llm_and_validates_output`
     - `test_assist_entity_type_prompt_returns_503_when_llm_capability_missing`
       - 覆盖 `rag.role_llm_funcs.get("query")` 与 `rag.llm_model_func` 都为 None / 不可调用的场景。
     - `test_assist_entity_type_prompt_returns_502_when_llm_call_raises`
       - 覆盖 provider 抛 ConnectionError / TimeoutError / generic Exception；响应体不得包含 provider 内部错误细节。
     - `test_assist_entity_type_prompt_returns_500_when_llm_returns_non_string`
       - 覆盖 provider 即使传 `stream=False` 仍返回 async iterator / dict / None 的场景。
     - `test_assist_entity_type_prompt_returns_validation_errors_for_invalid_yaml`
   - Dummy RAG 必须同时支持 `role_llm_funcs={"query": fn}` 与 `llm_model_func=fn` 两种 fixture 形态，记录 `prompt`、`system_prompt`、kwargs（含 `stream=False` 断言）。
2. Verify RED
   - Run:
     ```bash
     ./scripts/test.sh tests/test_workspace_prompt_routes.py -k "assist_entity_type_prompt" -q
     ```
   - Expected: endpoint 不存在或模型未定义导致失败。
3. Minimal code
   - 在 `prompt_routes.py` 新增 `PromptAssistRequest` / `PromptAssistResponse`（含 `raw_output` 字段）。
   - 新增 `POST /entity-type/assist` route。
   - 新增内部 helper `_resolve_assist_llm(rag)`：优先 `rag.role_llm_funcs.get("query")`，回落 `rag.llm_model_func`，都不可用时抛 503。
   - 暂时用最小 helper 调用 LLM 并返回校验结果；**不挂 `hashing_kv`**。
4. Verify GREEN
   - Run:
     ```bash
     ./scripts/test.sh tests/test_workspace_prompt_routes.py -k "assist_entity_type_prompt" -q
     ```
   - Expected: 新增测试通过。
5. Commit
   - Commit message:
     ```text
     feat(prompts): 增加提示词辅助生成后端契约
     ```

Repair Track:

- 新行为生效点：`POST /prompts/entity-type/assist`。
- 旧行为保留点：手动编辑、校验、保存、启用 API 不变。

Retirement Track:

- 不退役旧 prompt route。
- 不恢复旧 Prompt Management owner。

## Task 2: 后端 LLM prompt 构造与输出清理

Files:

- Modify: `lightrag/api/routers/prompt_routes.py`
- Modify: `tests/test_workspace_prompt_routes.py`

Why:

让生成内容结合系统自身提示词，同时避免 markdown fence、解释文本或无效 YAML 进入保存链路。

Impact/Compatibility:

只影响新 assist endpoint。

Steps:

1. Write test
   - 覆盖：
     - system prompt 包含默认 profile 的 `entity_types_guidance` **完整内容**（不是摘要，避免测试期望不稳定）以及 YAML 输出约束。
     - `test_assist_user_prompt_separates_requirements_from_current_content`：user prompt 内 `requirements` 与 `current_content` 必须用 `<current_yaml>...</current_yaml>` 标签隔离，且 `current_content` 不得嵌入 requirements 段落。
     - LLM 返回 ```yaml fence 时能提取 YAML。
     - LLM 返回纯解释文本（无 fence、无合法 YAML）时 `_validate_content()` 失败，响应仍带 `raw_output` 原文。
     - 超长 `requirements` / `current_content` 被 Pydantic 拒绝（422）。
     - LLM 调用必须显式传 `stream=False`；非 str 返回值（async iterator / dict / None）触发 500。
2. Verify RED
   - Run:
     ```bash
     ./scripts/test.sh tests/test_workspace_prompt_routes.py -k "assist_entity_type_prompt" -q
     ```
3. Minimal code
   - 新增 `_build_prompt_assist_system_prompt(use_json: bool, default_profile: dict) -> str`：注入完整默认 `entity_types_guidance` + YAML 输出约束 + 是否使用 JSON 模式提示。
   - 新增 `_build_prompt_assist_user_prompt(request, active_profile) -> str`：requirements 在外层、current_content 用 `<current_yaml>...</current_yaml>` 标签包裹。
   - 新增 `_strip_yaml_fence(raw: str) -> str`。
   - LLM 调用：
     - 强制 `stream=False`，**不挂 `hashing_kv`/`llm_response_cache`**，不传 `entity_extraction=True`（已废弃）。
     - 返回值 `isinstance(res, str)` 校验；非 str 抛 500 并日志记录 model 名称。
     - 捕获 LLM 异常 → 502，响应体仅含通用错误信息（不暴露 provider 内部细节）。
   - response 始终填充 `raw_output`，便于校验失败场景前端展示。
4. Verify GREEN
   - Run:
     ```bash
     ./scripts/test.sh tests/test_workspace_prompt_routes.py -k "assist_entity_type_prompt" -q
     ruff check lightrag/api/routers/prompt_routes.py tests/test_workspace_prompt_routes.py
     ```
5. Commit
   - Commit message:
     ```text
     feat(prompts): 复用运行时 LLM 生成提示词草稿
     ```

Repair Track:

- 新行为通过 `_validate_content()` 证明输出格式可用。
- 错误路径返回 HTTPException，不影响手动编辑。

Retirement Track:

- 不新增长期生成历史，因此没有后续清理 owner。

## Task 3: 前端 API client

Files:

- Modify: `lightrag_webui/src/api/lightrag.ts`
- Modify: `lightrag_webui/src/api/lightrag.prompts.test.ts`

Why:

让 Prompts 页面通过统一 API client 调用后端，继续复用 workspace header 和测试注入点。

Impact/Compatibility:

只新增函数和类型；现有函数签名不变。

Steps:

1. Write test
   - 在 `lightrag.prompts.test.ts` 增加 `assistEntityTypePrompt()` 调用断言：
     - method: `post`
     - url: `/prompts/entity-type/assist`
     - data 仅包含 `requirements`、`current_content`、`language`（**不含 `use_json`**，沿用后端默认）。
     - response 类型包含 `content`、`validation`、`warnings`、`raw_output`、`model`。
2. Verify RED
   - Run:
     ```bash
     cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts
     ```
3. Minimal code
   - 新增类型：
     - `EntityTypePromptAssistRequest`（不含 `use_json` 字段，保持前端 API 表面最小化）
     - `EntityTypePromptAssistResponse`（含 `raw_output: string`）
   - 新增函数：
     - `assistEntityTypePrompt(request)`。
4. Verify GREEN
   - Run:
     ```bash
     cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts
     ```
5. Commit
   - Commit message:
     ```text
     feat(webui): 增加提示词辅助生成 API 客户端
     ```

Repair Track:

- 新函数使用现有 `promptHttpClient`，测试可注入 mock。

Retirement Track:

- 不替换现有 validate/save/activate client。

## Task 4: Prompts 页面辅助编写 UI

Files:

- Modify: `lightrag_webui/src/pages/Prompts.tsx`
- Modify: `lightrag_webui/src/pages/Prompts.test.tsx`
- Modify: `lightrag_webui/src/locales/en.json`
- Modify: `lightrag_webui/src/locales/zh.json`
- Modify: `lightrag_webui/src/locales/zh_TW.json`
- Modify: `lightrag_webui/src/locales/ja.json`
- Modify: `lightrag_webui/src/locales/ko.json`
- Modify: `lightrag_webui/src/locales/fr.json`
- Modify: `lightrag_webui/src/locales/de.json`
- Modify: `lightrag_webui/src/locales/ru.json`
- Modify: `lightrag_webui/src/locales/uk.json`
- Modify: `lightrag_webui/src/locales/vi.json`
- Modify: `lightrag_webui/src/locales/ar.json`

Why:

给用户一个可控的辅助编写工作流：输入要求、生成草稿、预览、手动应用。

Impact/Compatibility:

页面新增控件，不改变现有保存/启用动作。

UI Design:

- 在编辑器上方或右侧工具区增加一个紧凑的 "Assist" 按钮。
- 点击后展开/打开辅助面板：
  - 多行输入框：用户要求（**不暴露 `use_json` 控件**，沿用后端默认）。
  - 生成按钮，生成中禁用。
  - 草稿预览区，只读显示 LLM 清理后的 YAML 结果（`response.content`）。
  - 校验失败时，额外折叠展示 `raw_output`（LLM 原始返回）以便用户判断 LLM 是否答非所问。
  - `Apply draft` 按钮，只有用户点击后才 `setState.content = draft`；校验失败时按钮可点击但需二次确认。
  - validation 状态沿用现有 `validation.valid/failed` 风格。
- 不使用营销式说明，不增加大 hero/card；保持管理工具密度。

Steps:

1. Write test
   - 在 `Prompts.test.tsx` mock `assistEntityTypePrompt`。
   - 覆盖状态 helper 或静态渲染：
     - 生成后 `draftContent` 存在但 `state.content` 未变。
     - apply 后 `state.content` 变成草稿。
     - API request 带当前编辑器内容，但 **不带 `use_json` 字段**。
     - 校验失败响应：UI 必须能展示 `raw_output`（默认折叠，可展开），且 `Apply draft` 按钮可点击但需二次确认。
     - 502/503/500 错误：toast 报错且草稿区不被污染。
2. Verify RED
   - Run:
     ```bash
     cd lightrag_webui && bun test src/pages/Prompts.test.tsx
     ```
3. Minimal code
   - 导入 `assistEntityTypePrompt`。
   - 增加 React state：`assistRequirements`、`assistDraft`、`assistRawOutput`、`assistLoading`、`assistValidation`。
   - 增加 handlers：`handleGenerateAssistDraft()`、`handleApplyAssistDraft()`。
   - 新增 i18n key（覆盖 11 个 locale）；非中英日语种可直接落英文兜底字符串，但 key 必须存在。
4. Verify GREEN
   - Run:
     ```bash
     cd lightrag_webui && bun test src/pages/Prompts.test.tsx
     cd lightrag_webui && bun run lint
     ```
5. Commit
   - Commit message:
     ```text
     feat(webui): 增加提示词辅助编写面板
     ```

Repair Track:

- 新行为只改变页面局部状态，保存仍走原 save flow。

Retirement Track:

- 不删除 preset 入口；辅助生成是补充入口。

## Task 5: 集成验证与文档同步

Files:

- Optional Modify: `docs/LightRAG-API-Server.md`
- Optional Modify: `docs/LightRAG-API-Server-zh.md`

Why:

确保公开 API 有记录，且前后端集成没有构建问题。

Impact/Compatibility:

文档同步，不改变运行逻辑。

Steps:

1. Write test
   - 无新增测试；使用前面任务测试作为覆盖。
2. Verify RED
   - 不适用；此任务是集成验证。
3. Minimal code
   - 若项目当前 API 文档列出 prompt routes，则补充 `POST /prompts/entity-type/assist`。
4. Verify GREEN
   - Run:
     ```bash
     ruff check lightrag/api/routers/prompt_routes.py tests/test_workspace_prompt_routes.py
     ./scripts/test.sh tests/test_workspace_prompt_routes.py -q
     cd lightrag_webui && bun test src/api/lightrag.prompts.test.ts src/pages/Prompts.test.tsx
     cd lightrag_webui && bun run lint
     cd lightrag_webui && bun run build
     ```
5. Commit
   - Commit message:
     ```text
     docs(prompts): 记录提示词辅助生成接口
     ```

Repair Track:

- 手工验证 LLM 不可用时手动 prompt 编辑仍可用。

Retirement Track:

- 若后续引入更通用的 prompt assistant，需要明确是否保留该 entity-type 专用 endpoint；在新 owner 落地前不删除。

# Rollback Plan

- 后端回滚：删除 `POST /prompts/entity-type/assist` route 和新增模型，不影响已有 prompt route。
- 前端回滚：删除辅助面板、API client 函数和 locale key，保留现有 Prompts 页面。
- 配置回滚：无需配置变更。

# Completion Criteria

- 后端 assist endpoint 能复用当前 runtime LLM 生成 YAML 草稿。
- 草稿经过 `_validate_content()` 校验，错误能返回给前端显示。
- 前端生成草稿不会自动覆盖编辑器；用户确认后才应用。
- 现有 prompt 列表、读取、校验、保存、启用、停用功能测试仍通过。
- `ruff`、相关 pytest、Bun tests、frontend build 均通过，或明确记录阻塞点。
