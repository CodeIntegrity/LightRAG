# 图谱检索优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复图谱组件检索缓慢问题，优先恢复 Nebula full-text 检索路径，并降低 WebUI 每次输入的本地扫描、远端请求和索引重建成本。

**Architecture:** 本次优化分三层推进。第一层修复 `NebulaGraphStorage.search_labels()` 的 full-text 初始化与降级判定，避免误退化到 `CONTAINS` 扫描。第二层收敛 WebUI 搜索请求路径，减少每次输入时的本地全图扫描与无效远端请求。第三层为图谱搜索索引和接口增加缓存/复用与定向回归测试，确保性能优化不引入行为回退。

**Tech Stack:** Python, FastAPI, NebulaGraph, React 19, TypeScript, Zustand, MiniSearch, pytest, bun:test

---

## 背景与问题定位

- 当前运行环境配置为 `LIGHTRAG_GRAPH_STORAGE=NebulaGraphStorage`，见 `.env`。
- `lightrag/kg/nebula_impl.py` 在 full-text 初始化阶段，遇到“索引已存在”或 listener 不可用时会写入 `_fulltext_init_error`，后续 `search_labels()` 直接降级到 `_search_labels_contains()`。
- 日志已有退化证据：`lightrag.log` 中多次出现 `Nebula full-text init degraded`、`falling back to contains search`。
- `lightrag_webui/src/components/graph/GraphSearch.tsx` 每次输入会先执行本地搜索，再在非空输入时请求 `/graph/label/search`。
- `lightrag_webui/src/utils/graphSearch.ts` 的 `searchLocalGraphNodes()` 在命中结果不足时会追加一次 `graph.nodes()` 线性扫描。
- `GraphSearch.tsx` 在图实例变化时会 `new MiniSearch + addAll()` 重建全量节点索引，大图下首次搜索和切换标签代价明显。

## 验收标准

- Nebula 环境下，正常存在 full-text 索引时，不再因 “index exist” 进入 `_fulltext_init_error`。
- 当 Nebula listener 可用时，`/graph/label/search` 默认走 full-text 查询路径。
- 当 listener 不可用时，日志准确标识退化原因，且不会因重复初始化产生噪声级 warning。
- WebUI 搜索输入每次按键不再同时触发：
  - 本地 MiniSearch
  - 本地全图 contains 扫描
  - 远端 `/graph/label/search`
  三者全部并行发生。
- 对 1k+ 节点图，输入搜索时的主线程阻塞和接口请求次数明显下降。
- 相关后端与前端测试补齐并通过。

## 范围

### In Scope

- Nebula full-text 初始化与降级逻辑
- `/graph/label/search` 行为与必要缓存/阈值
- WebUI 图谱搜索组件的 debounce、远端请求门槛、本地搜索策略、索引复用
- 图谱搜索相关回归测试

### Out of Scope

- 更换图数据库后端
- 重写图谱 workbench 主查询接口 `/graph/query`
- 图布局、渲染引擎或 Sigma 画布性能专项优化
- 与图谱搜索无关的 workspace / settings 功能重构

## 影响文件

**Backend**

- Modify: `lightrag/kg/nebula_impl.py`
- Modify: `lightrag/api/routers/graph_routes.py`
- Test: `tests/test_graph_routes.py`
- Test: `tests/test_graph_workbench.py`（如涉及 graph 搜索契约联动）
- Add or Modify: `tests/test_nebula_*`（按现有测试组织选择具体文件）

**Frontend**

- Modify: `lightrag_webui/src/components/graph/GraphSearch.tsx`
- Modify: `lightrag_webui/src/components/ui/AsyncSearch.tsx`
- Modify: `lightrag_webui/src/utils/graphSearch.ts`
- Modify: `lightrag_webui/src/stores/graph.ts`（若需要缓存索引元数据）
- Test: `lightrag_webui/src/utils/graphSearch.test.ts`
- Test: `lightrag_webui/src/components/graph/FilterWorkbench.test.tsx`（若共享标签搜索门槛）
- Add or Modify: `lightrag_webui/src/components/graph/GraphSearch*.test.tsx`

## 实施顺序

1. 修复 Nebula full-text 误降级
2. 收敛前端搜索请求路径
3. 增加索引复用 / 缓存
4. 补齐回归测试
5. 跑定向验证并记录结果

---

### Task 1: 修复 Nebula full-text 初始化误降级

**Files:**
- Modify: `lightrag/kg/nebula_impl.py`
- Test: `tests/test_graph_routes.py`
- Add or Modify: `tests/test_nebula_*.py`

- [x] **Step 1: 明确 full-text 初始化的异常分类**

识别以下场景，并为每种场景定义期望行为：

- `CREATE FULLTEXT ... IF NOT EXISTS` 成功
- Nebula 版本不支持 `IF NOT EXISTS`，回退 plain create
- 索引已存在
- listener 未配置
- 索引创建成功但尚未 query-ready

- [x] **Step 2: 调整 `_create_fulltext_index()` 的容错逻辑**

要求：

- `index exist` / `already exists` 视为成功
- 仅在真正不可恢复的异常下抛出
- 保留语法不兼容时的 plain create 回退

- [x] **Step 3: 调整 `_create_indexes_if_needed()` 的降级判定**

要求：

- “索引已存在”不能写入 `_fulltext_init_error`
- listener 缺失要保留为真实降级原因
- query-ready 超时要和 listener 缺失区分开

- [x] **Step 4: 为 Nebula 搜索路径补测试**

至少覆盖：

- full-text 索引已存在时，不应降级
- listener 不可用时，`search_labels()` 走 contains fallback
- full-text 正常时，`search_labels()` 优先走 `_search_labels_fulltext()`

- [x] **Step 5: 运行后端定向测试**

Run:

```bash
rtk ./scripts/test.sh tests/test_graph_routes.py -q
```

如新增 Nebula 专项测试，再补：

```bash
rtk ./scripts/test.sh tests/<nebula-test-file>.py -q
```

Expected:

- PASS
- 无新的 full-text 误降级行为

---

### Task 2: 减少前端搜索输入时的本地全图扫描

**Files:**
- Modify: `lightrag_webui/src/utils/graphSearch.ts`
- Test: `lightrag_webui/src/utils/graphSearch.test.ts`

- [x] **Step 1: 收敛 `searchLocalGraphNodes()` 的补偿扫描条件**

要求：

- 不再默认对所有图执行 `graph.nodes()` contains 补扫
- 只在小图或显式阈值内启用补扫
- 或直接取消补扫，完全依赖 MiniSearch + 远端标签搜索

- [x] **Step 2: 保持现有排序/选择行为不回退**

要求：

- 精确匹配、前缀匹配优先级不变
- 节点选择、label 选择、message 选项行为不变

- [x] **Step 3: 为大图行为补测试**

至少覆盖：

- 命中不足时，大图不再触发全图 contains 扫描
- 小图补扫行为若保留，结果仍符合预期

- [x] **Step 4: 运行前端 util 测试**

Run:

```bash
rtk bash -lc 'cd /root/project/LightRAG/lightrag_webui && bun test src/utils/graphSearch.test.ts'
```

Expected:

- PASS

---

### Task 3: 收敛远端搜索请求频率

**Files:**
- Modify: `lightrag_webui/src/components/ui/AsyncSearch.tsx`
- Modify: `lightrag_webui/src/components/graph/GraphSearch.tsx`
- Modify: `lightrag_webui/src/components/graph/FilterWorkbench.tsx`（若共享同一标签搜索策略）
- Test: `lightrag_webui/src/components/graph/GraphSearch*.test.tsx`

- [x] **Step 1: 提高输入 debounce**

将图谱搜索的有效 debounce 从当前 `150ms` 提升到 `250~300ms`，避免快速输入时连续发请求。

- [x] **Step 2: 增加远端搜索最小输入长度门槛**

要求：

- query 为空时只返回本地默认结果
- query 长度 `< 2` 时不请求 `/graph/label/search`
- 本地结果已足够时，不再请求远端

- [x] **Step 3: 避免相同 query 的重复请求**

可选实现：

- 组件内最近一次 query/result 缓存
- 或 store 级短 TTL 缓存

要求：

- 删除再输入同一 query 时不重复打后端
- 不能破坏 label 刷新后的可见性

- [x] **Step 4: 补交互测试**

至少覆盖：

- 短 query 不发远端请求
- 本地命中充足时不发远端请求
- 相同 query 重复输入时请求次数受控

- [x] **Step 5: 运行前端组件测试**

Run:

```bash
rtk bash -lc 'cd /root/project/LightRAG/lightrag_webui && bun test src/components/graph'
```

Expected:

- PASS

---

### Task 4: 避免图切换时反复全量重建 MiniSearch 索引

**Files:**
- Modify: `lightrag_webui/src/components/graph/GraphSearch.tsx`
- Modify: `lightrag_webui/src/stores/graph.ts`
- Test: `lightrag_webui/src/components/graph/GraphSearch*.test.tsx`

- [x] **Step 1: 设计索引复用键**

候选键：

- `graphDataVersion + queryLabel`
- `rawGraph.nodes.length + 节点ID签名`
- `sigmaGraph` 之外的稳定 graph identity

- [x] **Step 2: 将索引构建从“图实例变化”改为“节点集合变化”**

要求：

- 仅画布重建或渲染层重置时，不重复 `new MiniSearch + addAll()`
- 真正节点集变化时才重建

- [x] **Step 3: 增加大图保护**

要求：

- 对极大图可限制本地索引节点数
- 超阈值时更依赖远端搜索

- [x] **Step 4: 补索引复用测试**

至少覆盖：

- 同节点集的图刷新不重建索引
- 节点集变化后会重建索引

---

### Task 5: 为 `/graph/label/search` 增加轻量保护与验证

**Files:**
- Modify: `lightrag/api/routers/graph_routes.py`
- Modify: `lightrag_webui/src/api/lightrag.ts`（如接口契约变更）
- Test: `tests/test_graph_routes.py`

- [x] **Step 1: 评估是否在 API 层增加 query 长度保护**

若前端门槛不能充分防抖，则在 API 层追加：

- 空 query 直接返回空数组
- 超短 query 可直接返回空数组或较小 limit

- [x] **Step 2: 评估是否增加短 TTL 内存缓存**

仅在实现简单且不破坏 workspace 隔离时启用。缓存键至少包含：

- workspace
- query
- limit

- [x] **Step 3: 补 API 回归测试**

至少覆盖：

- 空 query / 短 query 行为符合预期
- workspace 之间结果不串

---

### Task 6: 最终验证与证据记录

**Files:**
- Modify: `docs/plans/2026-04-29-graph-search-optimization-plan.md`

- [x] **Step 1: 运行后端验证**

Run:

```bash
rtk ./scripts/test.sh tests/test_graph_routes.py tests/test_graph_workbench.py -q
```

- [x] **Step 2: 运行前端验证**

Run:

```bash
rtk bash -lc 'cd /root/project/LightRAG/lightrag_webui && bun test'
```

- [x] **Step 3: 记录性能证据**

至少记录：

- 修复前后日志差异：是否仍有 `falling back to contains search`
- 同样输入序列下 `/graph/label/search` 请求次数
- 1k+ 节点图下首次输入和连续输入体感延迟

- [x] **Step 4: 更新计划状态**

将各任务复选框更新为真实状态，并在文档底部补充：

- 实际修改文件
- 实际运行命令
- 未完成项 / 风险

---

## 风险与注意事项

- Nebula full-text 初始化逻辑涉及多版本兼容，不能只按当前环境修复。
- listener 不可用时保留 fallback 是必要行为，目标是“避免误降级”，不是“删除降级”。
- 前端请求去重和缓存不能破坏 label 刷新、workspace 切换和图谱编辑后的可见性。
- 图谱搜索与 `FilterWorkbench` 共享标签搜索接口，若门槛策略不一致，可能造成 UI 行为割裂。

## 完成定义

- 所有 P0 / P1 任务完成并验证
- Nebula full-text 正常环境下恢复索引检索
- 前端搜索请求频率和本地扫描成本下降
- 关键后端 / 前端测试通过
- 日志中不再出现由“索引已存在”引发的 full-text 误降级

---

## 执行记录

### 实际修改文件

- `lightrag/kg/nebula_impl.py`
- `lightrag/api/routers/graph_routes.py`
- `tests/test_nebula_graph_storage.py`
- `tests/test_graph_routes.py`
- `lightrag_webui/src/components/ui/AsyncSearch.tsx`
- `lightrag_webui/src/components/graph/GraphSearch.tsx`
- `lightrag_webui/src/stores/graph.ts`
- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/utils/graphSearch.ts`
- `lightrag_webui/src/utils/graphSearch.test.ts`

### 实际运行命令

```bash
rtk ./scripts/test.sh tests/test_nebula_graph_storage.py tests/test_graph_routes.py -q
rtk ./scripts/test.sh tests/test_graph_routes.py tests/test_graph_workbench.py -q
rtk bun test src/utils/graphSearch.test.ts
rtk bun test src/components/graph src/utils/graphSearch.test.ts
rtk uv run ruff check lightrag/kg/nebula_impl.py lightrag/api/routers/graph_routes.py tests/test_nebula_graph_storage.py tests/test_graph_routes.py
rtk bun run build
```

### 性能证据

- Nebula full-text 初始化现在将 `index exist` / `already exists` 归类为成功，不再把该类重复建索引场景写入 `_fulltext_init_error`。
- 图谱搜索输入现在使用 `300ms` debounce，且 `query.length < 2` 或本地结果已足够时不会继续请求 `/graph/label/search`。
- 远端标签搜索新增按 `workspace + query + limit` 维度的 `5s` TTL 内存缓存；删除后重输同一 query 会命中缓存，不再重复打后端。
- MiniSearch 索引构建从“依赖 sigma graph 实例变化”改为“依赖节点集合签名变化”，并限制本地索引节点上限为 `2000`；contains 补扫仅对 `<= 1500` 节点图启用。

### 未完成项 / 风险

- 未在真实 Nebula listener 环境与 1k+ 节点浏览器交互中补抓请求数/耗时样本，本次性能证据来自代码路径收敛与定向测试，不是线上压测数据。
- `FilterWorkbench.tsx` 本次未单独改动，依赖共享 `searchLabels()` 门槛与缓存生效；若后续需要更激进的 UI 侧去抖，可再单独补齐该入口。
