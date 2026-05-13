# Task Intent

- 请求结果：按 `docs/aegis/plans/2026-05-13-backend-runtime-and-workspace-optimization.md` 开始执行后端 runtime/workspace 优化。
- 作用范围：`lightrag/api/lightrag_server.py`、`lightrag/api/workspace_registry.py`、`lightrag/api/workspace_runtime.py` 及对应测试、文档。
- 非目标：不改存储层、图谱抽取层、WebUI 契约，不引入新依赖或新持久化表。
- 风险提示：HTTP `LIGHTRAG-WORKSPACE` 会从宽松纠错收紧为显式拒绝；runtime 快路径不能绕过 `ready/draining` 语义。

## Baseline Read Set Hint

- `docs/aegis/BASELINE-GOVERNANCE.md`
- `docs/LightRAG-API-Server.md`
- `docs/aegis/plans/2026-05-13-backend-runtime-and-workspace-optimization.md`
- `lightrag/api/lightrag_server.py`
- `lightrag/api/workspace_registry.py`
- `lightrag/api/workspace_runtime.py`
- `tests/test_workspace_runtime_app_integration.py`
- `tests/test_workspace_registry_store.py`
- `tests/test_workspace_runtime_manager.py`

## Impact Statement Draft

- 受影响入口：`/documents`、`/query`、`/graph`、`/graphs`、`/api` 的 runtime 绑定链路。
- 兼容边界：保持 header 名、workspace 生命周期接口、`ready` 语义和多 workspace 能力不变。
- 退役轨道：退役 header 自动 sanitize 的 HTTP 入口语义；缩小每请求固定 registry 查询路径。
