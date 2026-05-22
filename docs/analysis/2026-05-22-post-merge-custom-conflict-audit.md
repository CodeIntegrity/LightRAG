# 2026-05-22 上游合并后二开冲突审计

## 1. 结论

### 事实

- 审计对象为 `integrate/2026-05-22-upstream-main-prompt-retire`，authority upstream 为 `upstream/main`，merge commit 为 `3d9e5df2`。
- `3d9e5df2` 之后到当前 `HEAD f1bd639e` 共新增 `13` 个 post-merge 提交，直接改动 `46` 个文件，主要是把 merge 中丢失或被上游覆盖的本地二开能力重新补回。
- 相对 `upstream/main`，当前 post-merge 差异仍然很大：
  - backend workspace/pipeline 相关：`11 files changed, 4310 insertions(+), 1488 deletions(-)`
  - graph/custom-chunks 相关：`7 files changed, 5037 insertions(+), 41 deletions(-)`
  - frontend workspace/query/graph 相关：`13 files changed, 4239 insertions(+), 917 deletions(-)`
- 已跑定向验证后，现状不是“整体失控”，而是“多数补回已落位，但夹杂 4 组真实回归/兼容漂移和 3 组退役残留测试”。

### 判断

- `workspace runtime / registry / workspace routes` 仍应由**本地二开 owner** 持有，上游没有等价产品能力可以直接替换。
- `role_llm / pipeline / parser / multimodal` 仍应以**上游 owner** 为主，但要允许本地在 `lightrag_server.py` 和 route 层做 workspace/runtime 拼接。
- `graph workbench / graph routes / custom chunks rebuild` 仍应由**本地二开 owner** 持有，但当前有一个方向过滤正确性问题，需要尽快修。
- `frontend workspace / graph / retrieval settings` 仍应由**本地二开 owner** 持有，但存在运行时初始化和构建配置漂移。
- Prompt Management 已退役；与 prompt version store、API override、workspace-sensitive prompt draft 相关的旧测试/旧兼容断言应视为**退役残留**，不能再反向决定 owner。

### 结论

- 当前分支不是要“回退 post-merge 补回”，而是要**保留本地 owner，清理 merge 后遗留的几处真回归与失效测试**。
- 后续处理顺序应为：
  1. 修构建/初始化问题，恢复 WebUI build 与基础测试可跑。
  2. 修 graph direction 正确性问题。
  3. 清理 prompt retirement 残留测试与过时兼容断言。
  4. 更新 workspace runtime integration 测试假实现，使其适配新的 role-llm wiring。

## 2. 基线与增量

### 2.1 post-merge 关键提交

- `1272c844` `port(workspace): restore workspace/guest features to server and document routes`
- `000866f3` `port(role-llm): backport upstream role_llm/vlm/pipeline features to server`
- `2ec1f4fe` `port(custom-chunks): port arebuild_all_custom_chunks_graphs and helpers`
- `bda681b9` `port(frontend): restore pre-merge api/lightrag.ts with workspace support`
- `289b71b9` `fix(state): add workspace/guest fields to upstream state.ts`
- `ce860b83` `fix(state): add workspace fields to initial state object`
- `bb8272d2` `port(pipeline): restore document status pipeline, storage methods, and frontend features after merge`
- `31e0ed45` `feat(graph): 实体/关系删除增加乐观并发控制(revision_token)与前端联动`
- `f1bd639e` `fix(custom-chunks): 修复 ainsert_custom_chunks 与 rebuild 端点的 5 个缺陷和 2 项优化`

### 2.2 增量含义

- backend 补回的核心是：workspace 生命周期、guest/visibility、document/query route runtime 绑定、role-llm 与 pipeline 接线。
- graph 补回的核心是：graph workbench 查询协议、revision token 删除保护、custom chunks 图重建。
- frontend 补回的核心是：workspace API/types、graph workbench store、query settings、workspace 组件和状态管理。

## 3. 模块审计

### 3.1 Backend / Workspace / Pipeline

#### owner 判断

- **本地 owner 保留**
  - `lightrag/api/workspace_runtime.py`
  - `lightrag/api/workspace_registry.py`
  - `lightrag/api/routers/workspace_routes.py`
  - `lightrag/api/routers/document_routes.py` 中 workspace runtime 绑定逻辑
  - `lightrag/api/routers/query_routes.py` 中 workspace header 透传逻辑
- **上游 owner 为主，本地拼接**
  - `lightrag/api/lightrag_server.py`
  - `lightrag/pipeline.py`
  - `lightrag/utils_pipeline.py`
  - `lightrag/llm_roles.py`

#### 证据

- `lightrag/api/lightrag_server.py` 合并后重新引入了 workspace registry/runtime、auth sync、provider label、pipeline 状态与 role-llm wiring，属于“上游平台能力 + 本地产品能力”拼接点。
- `tests/test_workspace_runtime_manager.py` 通过（`6 passed`），`tests/test_document_routes_workspace_runtime.py` 通过（`2 passed`），说明 workspace runtime manager 和 document route 绑定主路径没有被 merge 破坏。
- `tests/test_llm_role_runtime.py` 通过（`35 passed`），`tests/test_pipeline_analyze_multimodal.py` 通过（`15 passed`），说明 role-llm 与 multimodal/pipeline 主路径整体可用。

#### 风险与漂移

- `tests/test_workspace_runtime_app_integration.py` 当前不是直接暴露 workspace runtime 代码坏掉，而是测试假模块仍只伪造 `ollama_model_complete` / `ollama_embed`，没有跟上 `create_role_llm_func()` 现在导入私有 helper `_ollama_model_if_cache` 的事实。
  - server 代码：`lightrag/api/lightrag_server.py:1247-1288`
  - 测试假模块：`tests/test_workspace_runtime_app_integration.py:174-184`
- `tests/test_query_raw_route.py` 仍向 `create_query_routes()` 传 `allow_prompt_overrides_via_api=True`，但该参数已随着 Prompt Management 退役被删除。
  - 当前 factory 签名：`lightrag/api/routers/query_routes.py:209-213`
  - 旧测试调用：`tests/test_query_raw_route.py:44-49`
- `tests/test_document_rebuild_route.py` 仍导入已退役的 `lightrag.prompt_version_store.PromptVersionStore`。
  - 旧导入：`tests/test_document_rebuild_route.py:9`

#### 判断

- backend 主代码的 owner 关系没有判断错；当前 backend 风险更多是**测试资产还停留在 prompt retirement 前或 role-llm backport 前**。
- 后续不应回退 `create_role_llm_func()`，应更新 integration tests 的 fake `lightrag.llm.ollama` 适配面。

### 3.2 Graph / Custom Chunks

#### owner 判断

- **本地 owner 保留**
  - `lightrag/api/graph_workbench.py`
  - `lightrag/api/routers/graph_routes.py`
  - `lightrag/utils_graph.py`
  - `lightrag/lightrag.py` 中 custom chunks rebuild / graph mutation 相关逻辑

#### 证据

- `lightrag/api/graph_workbench.py` 几乎是整块本地能力，定义了 graph request payload、filter/view option、directional scope、revision token、legacy payload 兼容等完整工作台协议。
- `31e0ed45` 又在 graph deletion 上追加了 optimistic concurrency（revision token）与前端联动，说明这里已经形成稳定的本地产品接口，不能交给上游覆盖。

#### 真实问题

- `query_graph_workbench()` 会在返回前做 `_apply_directional_scope(...)`，但它在取底图时调用 `_fetch_base_graph()` 并**没有把 direction 透传给 `rag.get_knowledge_graph()`**。
  - 取底图调用：`lightrag/api/graph_workbench.py:546-550`
  - 方向后过滤：`lightrag/api/graph_workbench.py:710-716`
  - 方向算法：`lightrag/api/graph_workbench.py:579-638`
- 对应测试明确要求 backend fetch 收到 `direction="outbound"` / `direction="inbound"`：
  - `tests/test_graph_workbench.py:250-311`
- 路由层也有同样失败：`tests/test_graph_routes.py::test_graph_query_accepts_scope_direction_and_forwards_it` 断言 `/graph/query` 应把 `direction="outbound"` 透传到底层，但实际收到的仍是 `both`。
- 实际结果：
  - `tests/test_graph_workbench.py` 共 `16` 个用例中 `14 passed, 2 failed`
  - `tests/test_graph_routes.py` 共 `32` 个用例中 `31 passed, 1 failed`
- custom chunk rebuild 路由另有一条真实行为漂移：`tests/test_document_additional_routes.py -k rebuild_custom_chunks_graph` 中 `test_rebuild_custom_chunks_graph_route_accepts_selected_doc_ids` 期望 `rebuild_started`，实际返回 `busy`。

#### 风险级别

- 这是**真实正确性问题**，不是纯测试过期。
- 如果底层 `get_knowledge_graph()` 的 `max_nodes` / `max_depth` 在方向过滤前就发生截断，那么先取“双向图”再在 workbench 层后过滤，可能拿不到本该存在的 inbound/outbound 邻接关系，结果会比测试暴露的问题更严重。
- custom chunk rebuild 的 `busy` 返回说明 route gate 与 helper 之间仍有状态编排问题，不是简单的导入/测试残留。

### 3.3 Frontend / Workspace / Retrieval

#### owner 判断

- **本地 owner 保留**
  - `lightrag_webui/src/api/lightrag.ts`
  - `lightrag_webui/src/stores/state.ts`
  - `lightrag_webui/src/stores/settings.ts`
  - `lightrag_webui/src/stores/graphWorkbench.ts`
  - `lightrag_webui/src/components/retrieval/QuerySettings.tsx`
  - `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
  - `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`

#### 证据

- `lightrag_webui/src/api/lightrag.ts` 补回了完整 workspace / graph workbench / query payload 类型，是当前 WebUI 与本地 API 协议的主要契约面。
- `lightrag_webui/src/api/lightrag.ts` 同时还是 manual splice 文件：既保留了 upstream health/auth 字段，也拼回了本地 `LIGHTRAG-WORKSPACE` header、workspace CRUD/stats/operation、graph workbench 和 revision-token mutation helper。
- `graphWorkbench` store 用例全部通过，说明 graph workbench 状态机本身没有明显 merge 级损坏。
- workspace header 契约是对齐的：前端统一发 `LIGHTRAG-WORKSPACE`，后端 server / workspace routes 读取同一 header 并做 sanitize/normalize。
- graph revision-token 契约也是对齐的：后端 query payload 注入 `revision_token`，graph mutation routes 接收 `expected_revision_token(s)` 并映射到 `409`，前端 helper / store / action inspector 也都已联动。

#### 真实问题

- `useAuthStore` 在模块初始化阶段直接访问 `localStorage`，导致非浏览器环境导入即炸：
  - `lightrag_webui/src/stores/state.ts:234-273`
  - `bun test src/stores/graphWorkbench.test.ts src/components/retrieval/QuerySettings.test.tsx` 报 `ReferenceError: localStorage is not defined`
- 同一个 `localStorage` 顶层读取问题也会直接打爆 `WorkspaceSwitcher` 的隔离测试：
  - `bun test src/components/workspace/WorkspaceSwitcher.test.tsx` -> `ReferenceError: localStorage is not defined`
  - `WorkspaceManagerDialog.test.tsx` 单独运行通过，因此更稳的结论是“workspace 组件测试基线被 auth store 初始化污染”，而不是 dialog 本体已确认回归。
- Vite build 当前直接失败，因为 `vite.config.ts` 已切到 `@vitejs/plugin-react-swc`，但 `package.json` / `bun.lock` 仍只有 `@vitejs/plugin-react`：
  - config import：`lightrag_webui/vite.config.ts:1-4`
  - package 现状：`lightrag_webui/package.json:96`

#### 低优先级兼容/退役残留

- `src/api/lightrag.workspace.test.ts` 仍要求 `setCurrentWorkspace()` 清掉 `promptManagementSelectedVersionId`、`retrievalPromptVersionSelection`、`retrievalPromptDraft`：
  - `lightrag_webui/src/api/lightrag.workspace.test.ts:35-55`
  - 但当前 `setCurrentWorkspace()` 只更新 `currentWorkspace`：
    `lightrag_webui/src/stores/settings.ts:295-298`
- 这更像 Prompt Management 退役后的**兼容清理债务**。如果产品确定不再读取这些遗留 persisted keys，可以删测试；如果仍要兼容旧浏览器持久化状态，则应在 `setCurrentWorkspace()` 或 hydration migration 里显式清理。

## 4. 定向验证结果

### 4.1 Backend

- `uv run ruff check lightrag tests` -> `PASS`
- `./scripts/test.sh tests/test_workspace_runtime_manager.py -q` -> `PASS` (`6 passed`)
- `./scripts/test.sh tests/test_document_routes_workspace_runtime.py -q` -> `PASS` (`2 passed`)
- `./scripts/test.sh tests/test_llm_role_runtime.py -q` -> `PASS` (`35 passed`)
- `./scripts/test.sh tests/test_pipeline_analyze_multimodal.py -q` -> `PASS` (`15 passed`)
- `./scripts/test.sh tests/test_graph_workbench.py -q` -> `FAIL` (`2 failed, 14 passed`)
- `./scripts/test.sh tests/test_graph_routes.py -q` -> `FAIL` (`1 failed, 31 passed`)
- `./scripts/test.sh tests/test_document_additional_routes.py -k rebuild_custom_chunks_graph -q` -> `FAIL` (`1 failed, 1 passed`)
- `./scripts/test.sh tests/test_workspace_runtime_app_integration.py -q` -> `FAIL` (`8 failed, 2 errors`)  
  主要由 fake `lightrag.llm.ollama` 未适配 `_ollama_model_if_cache` 引起
- `./scripts/test.sh tests/test_document_rebuild_route.py -q` -> `ERROR`  
  `ModuleNotFoundError: No module named 'lightrag.prompt_version_store'`
- `./scripts/test.sh tests/test_query_raw_route.py -q` -> `FAIL`  
  `TypeError: create_query_routes() got an unexpected keyword argument 'allow_prompt_overrides_via_api'`

### 4.2 Frontend

- `bun install --frozen-lockfile` -> `PASS`
- `bun test src/stores/graphWorkbench.test.ts src/components/retrieval/QuerySettings.test.tsx` -> `FAIL`
  - graphWorkbench store 用例通过
  - `QuerySettings` 组因 `state.ts` 顶层 `localStorage` 访问报错
- `bun test src/api/lightrag.workspace.test.ts src/stores/backendState.workspace.test.ts` -> `FAIL`
  - backendState 用例通过
  - workspace API 组仅剩 1 个失败，为 prompt-state reset 旧兼容断言
- `bun test src/components/workspace/WorkspaceManagerDialog.test.tsx src/components/workspace/WorkspaceSwitcher.test.tsx` -> `FAIL`
  - `WorkspaceManagerDialog.test.tsx` 单独运行通过（`19 passed`）
  - `WorkspaceSwitcher.test.tsx` 单独运行失败，根因是 `state.ts` 顶层 `localStorage` 访问
- `bun run build` -> `FAIL`
  - `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@vitejs/plugin-react-swc'`

## 5. 建议处理顺序

1. **先修 WebUI build 与初始化**
   - 统一 `vite.config.ts` 与 `package.json` 的 React plugin 选择
   - 给 `state.ts` 的 `localStorage` 初始化加浏览器守卫
   - 先让 `WorkspaceSwitcher` / `QuerySettings` 这条导入链可在非浏览器环境下稳定运行
2. **再修 graph direction**
   - 明确 direction 是否应透传到底层 `get_knowledge_graph()`
   - 若保留后过滤策略，需要同步修正 contract 与测试；若不保留，应把 direction 透传到 `_fetch_base_graph()`
3. **清理 prompt retirement 残留**
   - 删除/改写 `test_query_raw_route.py`
   - 删除/改写 `test_document_rebuild_route.py`
   - 判定 `lightrag.workspace.test.ts` 的 prompt-state reset 是否仍保留兼容意义
4. **更新 workspace runtime integration tests**
   - fake `lightrag.llm.ollama` 至少要覆盖 `_ollama_model_if_cache`
   - 然后再看 8 个失败里是否还有真实 workspace runtime 回归

## 6. owner matrix

| 模块 | 建议 owner | 原因 |
|---|---|---|
| workspace runtime / registry / routes | 本地二开 | 上游无等价产品能力 |
| lightrag_server role-llm/pipeline wiring | 上游为主，本地拼接 | 上游平台逻辑持续演进，本地只加 workspace/runtime 接线 |
| graph workbench / graph routes | 本地二开 | 本地协议与 UI 深度耦合 |
| custom chunks rebuild | 本地二开 | 本地 API、图谱重建流程和测试均已专门扩展 |
| WebUI workspace / graph / retrieval settings | 本地二开 | 直接承接本地 API 契约 |
| Prompt management tests / prompt override compat | 退役清理 | 已不再是 owner 判定依据 |
