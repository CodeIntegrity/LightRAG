# 设计：知识图谱筛选器过滤下推（#2 彻底版）

日期：2026-06-18 · 分支：main · 状态：设计待定（等范围决策）

## 问题

`query_graph_workbench` 当前数据流：
1. `rag.get_knowledge_graph(label, depth, max_nodes, direction)` 取**已截断**的基础子图
2. Python 在内存里跑 node/edge/source/view 过滤
3. 二次截断

根因在第 1 步的截断策略。以 NetworkX / Nebula 的 `label="*"` 为例：**按节点度数降序取 top-N**（[networkx_impl.py:580-591](lightrag/kg/networkx_impl.py#L580-L591)）。于是：

- **稀有/低度数实体类型**：在过滤前就被 top-N 丢弃 → 按 `entity_types` 筛稀有类型常返回空。
- **`degree_max` / `isolated_only`**：恰好筛的是低度数节点，而它们正是被截断丢掉的那批 → 几乎必然失真。
- **`description_query` / `name_query`**：目标节点若低度数，同样进不了样本。

即：**过滤跑在"按度数排好序的前 N 个"上，而非全图**。这是筛选器在大图上不可用的本质。本次 #1+#2 止血已在 `meta.filtered_on_truncated_base` 如实暴露，但未解决。

## 现状能力盘点

| 后端 | get_knowledge_graph | get_all_nodes/edges | get_all_entity_types | 查询语言可下推 WHERE |
|------|------|------|------|------|
| NebulaGraphStorage（本部署） | ✓ top-N by degree | ✓ 全表 MATCH | ✓ | ✓ nGQL |
| NetworkXStorage（代码默认） | ✓ | ✓ 内存 | （继承默认） | N/A 内存直接过滤 |
| Neo4j / Memgraph | ✓ | ✓ | ✓ | ✓ Cypher |
| PGGraph / Mongo / OpenSearch | ✓ | ✓ | ✓ | ✓ SQL/AGE / 查询 DSL |

关键：`get_all_nodes/get_all_edges` 7 个后端**都已实现**，是天然的后端无关原语。

## 方案

### 方案 A：过滤前置（filter-first via get_all，后端无关）

仅当 `label="*"` **且节点选择类过滤激活**时，改走：`get_all_nodes()` + `get_all_edges()` → Python 过滤 → 在**匹配集**上按度数 top-N 截断。普通浏览（无过滤）仍走原 top-N 快路径。

- 改动集中在 `graph_workbench.py` 一处分支 + 一个新的"全量取数"hook；**零查询语言改动**，7 后端通吃。
- 复用既有 Python 过滤函数（`_matches_node_filters` 等）。
- **内存有界**：设扫描上限（如 50k 节点）；超限则回退原路径并置 `filtered_on_truncated_base=true` 如实告知。
- 代价：大图上 `get_all_nodes` 全表扫描有成本，但 ① 仅过滤时触发 ② 有上限兜底。
- 局限：**真正百万级图**仍受扫描上限制约，此时需方案 B。

### 方案 B：逐后端谓词下推（可扩展，工程量大）

给 `get_knowledge_graph` 增结构化节点谓词（或新方法 `get_filtered_knowledge_graph`），各后端把 entity_types / name / degree 翻译进 nGQL/Cypher/SQL 的 WHERE。

- 真正解决任意规模：DB 侧先过滤再 top-N。
- 工程量：7 后端 × 查询语言，加 `KnowledgeGraph` 契约扩展、能力探测、未实现后端回退方案 A。
- 风险：跨后端语义对齐（大小写、数组成员、度数计算），测试矩阵大。

### 方案 C：混合（推荐路线）

**先方案 A 全后端落地** → 用本部署 Nebula 真实图压测过滤路径 → **仅当 A 在该图上确实太慢，才对 Nebula 单点做方案 B 下推**，其余后端留在 A。

理由：B 的全后端下推是投机性工程；A 已能修正确性，且 `get_all_nodes` 是否真慢要测了才知道。先 A、按需 B，符合最短路径。

## 关键决策（待用户定）

1. **图规模**：当前 Nebula 图节点量级？决定 A 的扫描上限是否够用、是否需要直接上 B。
2. **范围**：A（全后端、快、规模有界）/ B（全后端下推、慢、彻底）/ C（A 先行，Nebula 按需下推）。
3. **下推哪些过滤**：建议只下推**节点选择类**（entity_types、name_query、description_query、degree、isolated_only）；edge/source/view 过滤是次级、受截断影响小，仍在 Python 后置即可。

## 非目标

- 不动 #1 source 语义（已定方案 A：边过滤 + UI 澄清）。
- 不在本设计内做 #3~#10。

## 实现（方案 A，已落地）

用户选 **C 混合**：先全后端落地 A，再按需对 Nebula 下推。A 已实现：

- [graph_workbench.py](../../../lightrag/api/graph_workbench.py)
  - 常量 `FILTER_FIRST_SCAN_LIMIT = 50_000`（扫描上限，超限回退并如实上报）。
  - `_supports_full_scan` / `_adapt_full_scan_node` / `_adapt_full_scan_edge` / `_fetch_full_graph`：把 `get_all_nodes/get_all_edges` 的扁平属性 dict 适配成 `{id,labels,properties}` / `{id,type,source,target,properties}` 规范形状。
  - `query_graph_workbench`：当 `label=="*"` 且数据类过滤激活且后端支持全量取数且无 backend_query_hook → 走 filter-first（全量取数 → 复用既有 Python 过滤 → 末尾 guardrail 截断）。否则原 bounded 路径。
  - `execution_mode` 随路径取 `"filter_first_full_scan"` / `"post_truncation_filter"`。filter-first 命中时 `was_truncated_before=False`、`filtered_on_truncated_base=False`（在全图上过滤）；超限回退时如实置真。
  - **附带修正 #4**：filter-first 路径的 degree/isolated_only 基于全图边计算，度数真实（bounded 路径仍是子图度数）。
- [graph_routes.py](../../../lightrag/api/routers/graph_routes.py)：`GraphQueryMeta.execution_mode` 由死锁的 `Literal["base_graph_only_placeholder"]` 放宽为 `Literal["post_truncation_filter","filter_first_full_scan"]`，补 `filtered_on_truncated_base`，`ignored_filter_groups` 默认空。（此前 #2 的新值会被该 Literal 拒为 500，本次一并修复。）
- 测试：`test_graph_workbench.py` 新增 4 例（稀有类型保留、超限回退、无过滤不扫、非全图标签不扫）；`test_graph_routes.py` meta 断言对齐。55 passed。

边界与回退：

- 仅 `label=="*"` 触发——指定起点标签是 BFS、非 top-N 度数截断问题。
- 节点扫描 > 50k → 回退 bounded 并 `filtered_on_truncated_base=true`，前端弹"基于截断样本"警示。
- 复用 7 后端都已实现的 `get_all_*`，零查询语言改动。

## 后续：方案 B（Nebula 下推，按需）

仅当 A 在真实 Nebula 图上压测确实太慢才做：把 entity_types/name/degree 谓词翻译进 `get_knowledge_graph` 的 nGQL WHERE，DB 侧先过滤再 top-N。其余后端留在 A。触发条件：实测 `get_all_nodes` 全表扫描成为瓶颈。

### 压测结果（2026-06-18）

脚本 [scripts/bench_filter_first.py](../../../scripts/bench_filter_first.py)（只读，可重跑，`WORKSPACE=xxx` 切库）：

| space | 节点/边 | get_all_nodes+edges | filter-first 全程 | bounded `get_knowledge_graph('*')` |
|---|---|---|---|---|
| `lightrag__test` | 1649 / 1516 | 144+153ms | **377ms** | 934ms |
| `lightrag__work_a4` | 14526 / 14525 | 1029+1221ms | **2418ms** | **5392ms** |

- 两档规模下 **filter-first 都比 bounded 路径更快**：bounded 在 `max_graph_nodes < 全图` 时要对全量节点做度数排序再取 top-N，比扁平 MATCH 更重。
- 万级图扫描量 14526 仍远低于 50k 上限（3.4x 余量）。筛稀有类型 `WrapUpItem` 救回 4 个节点——正是会被 top-N 度数截断丢掉的场景。

**结论：到 1.5 万节点方案 B 仍不必做。** 线性外推 ~0.17ms/节点，到 50k 上限约 8.4s（接近可接受上限，超限自动回退）。触发方案 B 的条件：真实图逼近/超过 5 万节点、重跑此脚本显示 filter-first 明显劣化。可选的轻量缓解（先于 B）：连续筛选间缓存 `get_all_nodes/edges` 结果。

