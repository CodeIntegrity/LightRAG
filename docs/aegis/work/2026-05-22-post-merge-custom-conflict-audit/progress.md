# Progress

1. 创建隔离审计 worktree：`.worktrees/audit-2026-05-22-post-merge-conflicts`
2. 建立审计分支：`audit/2026-05-22-post-merge-conflicts`
3. 记录 merge base / merge commit / post-merge commits / diffstat
4. 建立三条审计切面：
   - backend workspace / pipeline / role-llm
   - graph / custom chunks / revision-token
   - frontend workspace / query / graph
5. 在审计 worktree 中补齐验证环境：
   - `uv sync --extra api --extra test --extra offline-storage --extra offline-llm`
   - `bun install --frozen-lockfile`
6. 跑后端定向验证并分类：
   - workspace/runtime manager、document runtime、role-llm、multimodal pipeline 通过
   - graph direction、custom chunk rebuild、retired prompt tests、workspace runtime integration drift 失败
7. 跑前端定向验证并分类：
   - graphWorkbench store、WorkspaceManagerDialog 单测通过
   - `localStorage` 顶层读取、vite React plugin mismatch、prompt retirement 旧断言失败
8. 汇总 owner 结论、真实回归、退役残留，落盘到 `docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
9. 修复 WebUI 初始化 / build 问题：
   - `lightrag_webui/src/stores/state.ts` 增加安全的 `localStorage` 读写包装
   - `lightrag_webui/vite.config.ts` 改回 `@vitejs/plugin-react`
10. 修复后端真实回归：
   - `lightrag/api/graph_workbench.py` 透传 `direction`
   - `lightrag/api/routers/document_routes.py` 去掉路由层对 custom chunk rebuild 的抢占式 `busy` 写入
11. 清理 prompt retirement / runtime drift 测试：
   - `tests/test_query_raw_route.py` 对齐 `create_query_routes()` 新签名
   - `tests/test_document_rebuild_route.py` 去掉已退役 `PromptVersionStore` 依赖
   - `tests/test_workspace_runtime_app_integration.py` 补齐 fake ollama 模块和 dummy role-llm 接口
   - `lightrag_webui/src/api/lightrag.workspace.test.ts` 删除已退役 prompt 状态断言
12. 完成定向回归：
   - `tests/test_graph_workbench.py`
   - `tests/test_graph_routes.py`
   - `tests/test_query_raw_route.py`
   - `tests/test_document_rebuild_route.py`
   - `tests/test_workspace_runtime_app_integration.py`
   - `tests/test_document_additional_routes.py -k rebuild_custom_chunks_graph`
   - `bun test src/stores/graphWorkbench.test.ts src/components/retrieval/QuerySettings.test.tsx src/components/workspace/WorkspaceManagerDialog.test.tsx src/components/workspace/WorkspaceSwitcher.test.tsx src/api/lightrag.workspace.test.ts`
13. 完成 WebUI build 验证：`bun run build`
