# Findings

## Owner 结论

- `workspace runtime / registry / workspace routes`：keep local owner。
- `lightrag_server` 中 `role_llm / pipeline / parser / multimodal`：以上游为主，本地保留 workspace/runtime 拼接。
- `graph workbench / graph routes / revision_token / custom chunk rebuild`：keep local owner，未来 refresh 走 manual splice。
- `lightrag_webui/src/api/lightrag.ts`：manual splice，不适合整文件选 upstream 或 local。
- Prompt Management：继续退役，相关旧测试/旧兼容断言不再决定 owner。

## 已验证的真实问题

- graph direction 没有透传到底层 `rag.get_knowledge_graph()`，`test_graph_workbench.py` 与 `test_graph_routes.py` 都能复现。
- custom chunk rebuild 的 selected `doc_ids` 路由返回 `busy`，与预期 `rebuild_started` 不符。
- `lightrag_webui/src/stores/state.ts` 在模块初始化阶段直接读取 `localStorage`，会打爆 `QuerySettings` / `WorkspaceSwitcher` 非浏览器测试链路。
- `vite.config.ts` 引用了 `@vitejs/plugin-react-swc`，但 `package.json` / `bun.lock` 仍只声明 `@vitejs/plugin-react`，`bun run build` 直接失败。

## 已完成修复

- `_fetch_base_graph()` 现在会透传规范化后的 `direction` 到 `rag.get_knowledge_graph()`。
- custom chunk rebuild route 不再提前把 `pipeline_status["busy"]` 置为 `True`；状态 owner 回到 `arebuild_all_custom_chunks_graphs()`。
- auth store 初始化与登录路径改为通过安全包装访问 `localStorage`，Node/Bun 测试环境不再在 import 时炸掉。
- WebUI build 已与锁文件对齐，使用 `@vitejs/plugin-react` 可稳定构建。
- prompt retirement 残留测试已对齐当前契约，不再引用已删除的后端 prompt 管理接口。
- workspace runtime integration 测试 dummy 已补齐当前 role-llm / ollama helper 面，能够覆盖 app startup/runtime 绑定路径。

## 已确认的测试/退役残留

- locale 文件中仍保留 prompt version 文案键，但当前运行时代码与测试主路径已不再依赖它们。
- worktree 内 `lightrag_webui/.gitignore` 存在一处无关工具忽略项修改；本轮未回滚。

## 已验证通过的主路径

- `ruff check lightrag tests`
- `tests/test_workspace_runtime_manager.py`
- `tests/test_document_routes_workspace_runtime.py`
- `tests/test_llm_role_runtime.py`
- `tests/test_pipeline_analyze_multimodal.py`
- `lightrag_webui/src/stores/graphWorkbench.test.ts`
- `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx`
- `tests/test_graph_workbench.py`
- `tests/test_graph_routes.py`
- `tests/test_query_raw_route.py`
- `tests/test_document_rebuild_route.py`
- `tests/test_workspace_runtime_app_integration.py`
- `tests/test_document_additional_routes.py -k rebuild_custom_chunks_graph`
- `lightrag_webui/src/components/retrieval/QuerySettings.test.tsx`
- `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`
- `lightrag_webui/src/api/lightrag.workspace.test.ts`
- `bun run build`
