# Goal

在不改变现有 API 契约和多 workspace 能力的前提下，完成后端运行时绑定路径的第一轮优化，优先解决错误映射、workspace 识别歧义和热路径多余 I/O 三个已取证问题。

# Architecture

本次优化只动 3 个边界：

1. API 入口边界：`lightrag/api/lightrag_server.py`
2. workspace 元数据边界：`lightrag/api/workspace_registry.py`
3. runtime 缓存与请求绑定边界：`lightrag/api/workspace_runtime.py`

不扩展到存储层、图谱抽取层和 WebUI 契约。

# Tech Stack

- Python 3
- FastAPI
- asyncio
- SQLite workspace registry
- pytest

# Baseline/Authority Refs

- `docs/aegis/BASELINE-GOVERNANCE.md`
- `docs/LightRAG-API-Server.md`
- `lightrag/api/lightrag_server.py`
- `lightrag/api/workspace_registry.py`
- `lightrag/api/workspace_runtime.py`
- 审查证据：
  - `lightrag/api/lightrag_server.py:787`
  - `lightrag/api/workspace_registry.py:328`
  - `lightrag/api/lightrag_server.py:890`
  - `lightrag/api/workspace_runtime.py:98`

# Compatibility Boundary

- 保持现有路由、请求头名 `LIGHTRAG-WORKSPACE`、workspace 生命周期接口不变。
- 不改变 `ready` workspace 的业务语义。
- 不引入新的持久化表或外部依赖。
- 允许把“非法 workspace header 自动纠错”收紧为显式拒绝，但必须返回稳定、可预期的 HTTP 错误。
- 任何优化都不能让删除/排空中的 workspace 重新接受请求。

# Verification

- `python3 -m pytest tests/test_lightrag_server.py -q`
- `python3 -m pytest tests/test_workspace_registry.py -q`
- `python3 -m pytest tests/test_workspace_runtime.py -q`
- 若无现成覆盖，则新增后执行：
  - `python3 -m pytest tests/test_lightrag_server.py -k workspace -q`
  - `python3 -m pytest tests/test_workspace_runtime.py -k cache -q`

# Problem Summary

当前后端存在三个已取证问题：

1. workspace registry 的任意异常都在中间件里被映射成 `404 workspace not registered`，掩盖真实故障。
2. 请求头中的非法 workspace 标识会被静默改写为下划线版本，存在命中错误 workspace 的风险。
3. 运行时绑定中间件在每个热路径请求上都先查一次 registry，再查 runtime cache，导致本可内存命中的请求仍有固定 SQLite 开销。

# Fact / Assumption / Unknown

## Facts

- `workspace_runtime_binding()` 当前对 `get_workspace()` 使用宽泛 `except Exception`。
- `get_workspace()` 在 workspace 不存在时抛 `WorkspaceNotFoundError`。
- header 入口使用 `sanitize_workspace_identifier()`，而 registry 创建路径使用 `normalize_workspace_identifier()`。
- `WorkspaceRuntimeManager` 已有内存 cache、draining 标记和并发保护锁。

## Assumptions

- API 使用方可以接受非法 workspace header 从“自动修正”变为“400 拒绝”。
- runtime cache 命中时，重复访问 registry 不是必需的强一致性手段。

## Unknowns

- 现有测试是否已经覆盖非法 header、registry 异常分类、runtime cache 命中路径。
- 是否存在依赖“header 被自动纠错”的上游调用方。

# Ripple Signal Triage

- Owner scope: 仅后端 API/runtime 层，未扩展到存储层。
- Downstream scope: 所有经过 `/documents`、`/query`、`/graph`、`/graphs`、`/api` 的请求。
- Contract scope: HTTP 错误码可能从部分历史隐式行为变为更严格的 `400/500`。
- Verification scope: 需要覆盖成功路径、非法 header、workspace 不存在、registry 内部错误、draining workspace。
- Source-of-truth scope: workspace 合法性应统一由 `normalize_workspace_identifier()` 定义。

# File Ownership Map

- API middleware / request parsing:
  - `lightrag/api/lightrag_server.py`
- Workspace validation and exceptions:
  - `lightrag/api/workspace_registry.py`
- Runtime cache / readiness checks:
  - `lightrag/api/workspace_runtime.py`
- Tests:
  - `tests/test_lightrag_server.py`
  - `tests/test_workspace_registry.py`
  - `tests/test_workspace_runtime.py`

# Risks

- 把 header 校验收紧后，可能暴露历史调用方传错 workspace 的问题。
- 若 runtime 快路径设计不完整，可能让已被删除或未 ready 的 workspace 绕过状态校验。
- 若错误分类过度简化，可能把内部异常暴露得过多或日志不足。

# Rollback Surface

- 变更集中在 API/runtime 层，可单独回滚。
- 若严格校验导致兼容问题，可暂时保留 feature flag 或仅对 header 路径降级。
- 若 runtime 快路径验证不足，可先只修错误分类和 header 语义，把 cache 优化拆到后续提交。

# Retirement Track

- 旧逻辑 1：`sanitize_workspace_identifier()` 用于 HTTP header 容错。
  - 目标：从请求入口退役。
  - 保留条件：仅限 CLI/兼容迁移路径。
- 旧逻辑 2：中间件先 registry 后 runtime 的全量校验顺序。
  - 目标：缩小到 cache miss 或状态变更路径。
  - 保留条件：若测试证明它承担了必要强一致性语义，再退回只做局部优化。

# Task 1 - 修正 workspace registry 异常映射

Files:
- `lightrag/api/lightrag_server.py`
- `tests/test_lightrag_server.py`

Why:
- 让 `404` 只表示“不存在”，把真实内部错误与业务错误分开。

Impact/Compatibility:
- API 错误码更准确。
- 业务上不存在的 workspace 仍返回 `404`。

Verification:
- `python3 -m pytest tests/test_lightrag_server.py -k "workspace and (404 or 500)" -q`

Repair Track:
- Root cause: 宽泛 `except Exception` 混淆业务异常和系统异常。
- Canonical owner: `workspace_runtime_binding()`。
- Minimal change: 仅精确捕获 `WorkspaceNotFoundError`，其余异常记录日志并返回 `500`。

Retirement Track:
- 退役旧的“全部异常都回 404”分支。

- [ ] 写测试，覆盖 `WorkspaceNotFoundError` 返回 `404`、registry 非业务异常返回 `500`
- [ ] 运行测试并确认先失败：`python3 -m pytest tests/test_lightrag_server.py -k "workspace and (404 or 500)" -q`
- [ ] 在 `lightrag/api/lightrag_server.py` 中收窄异常捕获并补足日志
- [ ] 重新运行同一组测试并确认转绿
- [ ] 提交：`git commit -m "fix(api): classify workspace registry errors correctly"`

# Task 2 - 统一 HTTP workspace 校验语义

Files:
- `lightrag/api/lightrag_server.py`
- `lightrag/api/workspace_registry.py`
- `tests/test_lightrag_server.py`
- `tests/test_workspace_registry.py`

Why:
- 防止非法 header 被静默映射到另一个合法 workspace。

Impact/Compatibility:
- 非法 workspace header 将显式失败。
- workspace 创建/查询/请求入口都共享同一合法性定义。

Verification:
- `python3 -m pytest tests/test_lightrag_server.py -k "workspace and header" -q`
- `python3 -m pytest tests/test_workspace_registry.py -k workspace -q`

Repair Track:
- Root cause: HTTP 入口使用 `sanitize_workspace_identifier()`，与 registry 的严格校验模型不一致。
- Canonical owner: `resolve_request_workspace()` / `get_workspace_from_request()`。
- Minimal change: 对 header 输入调用 `normalize_workspace_identifier()`，失败时返回 `400`。

Retirement Track:
- `sanitize_workspace_identifier()` 退出 HTTP 请求路径；保留在明确的兼容入口中，若无剩余调用则删除。

- [ ] 写测试，覆盖非法 header 返回 `400`、合法 header 保持原行为、默认 workspace 回退不变
- [ ] 运行测试并确认先失败：`python3 -m pytest tests/test_lightrag_server.py -k "workspace and header" -q`
- [ ] 在请求入口统一改用严格校验；必要时保留 `sanitize_workspace_identifier()` 仅供非 HTTP 路径
- [ ] 跑 `python3 -m pytest tests/test_lightrag_server.py tests/test_workspace_registry.py -k workspace -q`
- [ ] 提交：`git commit -m "fix(api): validate workspace header strictly"`

# Task 3 - 为 runtime 绑定增加 cache-first 快路径

Files:
- `lightrag/api/lightrag_server.py`
- `lightrag/api/workspace_runtime.py`
- `tests/test_lightrag_server.py`
- `tests/test_workspace_runtime.py`

Why:
- 降低热路径上的重复 registry 查询，让已缓存且可服务的 workspace 直接走内存路径。

Impact/Compatibility:
- 不改变 workspace `ready/draining` 语义。
- cache miss、draining、hard delete、not ready 仍必须走现有保护路径。

Verification:
- `python3 -m pytest tests/test_workspace_runtime.py -k cache -q`
- `python3 -m pytest tests/test_lightrag_server.py -k workspace -q`

Repair Track:
- Root cause: 中间件对每个请求固定执行 registry 查询，再获取 runtime。
- Canonical owner: `WorkspaceRuntimeManager.acquire_runtime()` 与调用方绑定顺序。
- Minimal change: 提供只读方法判断某 workspace 是否已有可接受请求的 cached runtime，命中则直接 acquire；未命中时再走 registry 校验。

Retirement Track:
- 缩小“每请求先查 registry”这条旧路径，只保留给 cache miss 和状态敏感路径。

- [ ] 写测试，覆盖 cached ready workspace 不触发 registry 查询、cache miss 仍会校验、draining workspace 仍拒绝
- [ ] 运行测试并确认先失败：`python3 -m pytest tests/test_workspace_runtime.py tests/test_lightrag_server.py -k workspace -q`
- [ ] 在 `WorkspaceRuntimeManager` 增加只读 cache 状态探测，并在 middleware 中接入
- [ ] 重新运行相关测试，必要时补跑全文件：`python3 -m pytest tests/test_lightrag_server.py tests/test_workspace_runtime.py -q`
- [ ] 提交：`git commit -m "perf(api): avoid redundant registry lookup on cached runtimes"`

# Task 4 - 回归、自测与文档补丁

Files:
- `docs/LightRAG-API-Server.md`
- `docs/LightRAG-API-Server-zh.md`
- 若测试缺口暴露，则补相关 `tests/*.py`

Why:
- 让 API 使用方知道 workspace header 的严格校验语义，避免“行为变了但文档没变”。

Impact/Compatibility:
- 只更新文档，不改变代码路径。

Verification:
- `python3 -m pytest tests/test_lightrag_server.py tests/test_workspace_registry.py tests/test_workspace_runtime.py -q`

- [ ] 更新 API 文档，说明 `LIGHTRAG-WORKSPACE` 的合法字符和非法值返回码
- [ ] 运行定向测试：`python3 -m pytest tests/test_lightrag_server.py tests/test_workspace_registry.py tests/test_workspace_runtime.py -q`
- [ ] 手动检查受影响代码差异：`git diff -- lightrag/api/lightrag_server.py lightrag/api/workspace_runtime.py lightrag/api/workspace_registry.py docs/LightRAG-API-Server.md docs/LightRAG-API-Server-zh.md`
- [ ] 确认没有引入未计划的接口改动
- [ ] 提交：`git commit -m "docs(api): document workspace validation and runtime behavior"`

# Self-Review

- Spec coverage: 已覆盖 3 个已取证问题，未擅自扩展到存储或抽取层。
- Placeholder scan: 无 TBD/TODO。
- Type consistency: 计划统一以 `WorkspaceNotFoundError`、`WorkspaceValidationError`、`WorkspaceStateError` 为边界。
- Compatibility: 明确约束了 header 名、workspace 生命周期、draining 语义。
- Verification: 每个任务均有精确测试命令。
- Dual-track: 已标明 sanitize 路径和 registry-first 路径的退役策略。

