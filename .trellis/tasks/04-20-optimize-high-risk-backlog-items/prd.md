# Optimize High-Risk Backlog Items

## Goal
修复 backlog 中两个高风险问题，避免默认 workspace hard delete 破坏主运行时，并消除 `QueryParam()` 默认参数共享带来的跨请求状态泄漏。

## Requirements
- hard delete 路由禁止删除当前 active workspace，默认 workspace 也必须被拦截。
- hard delete 流程不得复用主 `rag` 实例做清理，避免清理流程关闭主运行时资源。
- `LightRAG` 公开查询接口不再使用 `QueryParam()` 作为默认参数。
- 查询实现不得原地修改调用方传入的 `QueryParam` 对象。
- 为以上修复补充回归测试。

## Acceptance Criteria
- [ ] 当前 active/default workspace 的 hard delete 请求返回明确错误，且不进入删除调度。
- [ ] hard delete 清理完成后不会对主 `rag` 实例执行 `finalize_storages()`。
- [ ] `query` / `aquery` / `query_data` / `aquery_data` / `query_llm` / `aquery_llm` 在省略 `param` 时不会共享状态。
- [ ] bypass / 非 bypass 查询都不再修改调用方传入的 `QueryParam` 实例。
- [ ] 相关离线测试通过。

## Technical Notes
- 修改范围集中在 `lightrag/api/routers/workspace_routes.py`、`lightrag/api/lightrag_server.py`、`lightrag/lightrag.py` 及相关测试。
- 这是跨 API 路由、运行时生命周期与核心查询接口的跨层修复，优先保持现有调用方式兼容。
