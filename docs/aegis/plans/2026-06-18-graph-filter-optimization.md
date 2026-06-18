# 计划：知识图谱筛选器优化（#1 + #2）

日期：2026-06-18 · 分支：main · 范围：止血式两项，最小改动最大收益

## 目标

- **#1（正确性 bug）**：source 过滤对**节点**完全失效。`_matches_source_filters` 只在边循环调用，节点循环从不按 source 过滤。按 `file_path` / `source_id` / 时间窗筛选时节点全量保留、只裁边，且 summary 仍把 source 计入 `filtering_applied`，结果静默错误。
- **#2（语义诚实）**：过滤发生在 `max_nodes` 截断**之后**，筛的是样本而非全图。`meta.execution_mode` 至今是占位 `"base_graph_only_placeholder"`、`ignored_filter_groups` 恒空，前端无从判断结果是否可信。本次**只如实暴露语义 + 前端提示**，不做过滤下推。

非目标：过滤下推到存储层（#2 彻底版，挂起）、#3~#10 各项。

## 影响面

| 文件                                                            | 改动                                    |
| --------------------------------------------------------------- | --------------------------------------- |
| `lightrag/api/graph_workbench.py`                               | #1 节点 source 过滤；#2 meta 字段如实化 |
| `lightrag_webui/src/api/lightrag.ts`                            | #2 meta 返回类型补字段                  |
| `lightrag_webui/src/components/graph/GraphWorkbenchSummary.tsx` | #2 截断+过滤并存时显示提示              |
| `lightrag_webui/src/locales/{en,zh}.json`                       | #2 提示文案                             |
| `tests/test_graph_workbench.py`                                 | #1 #2 用例                              |

## 阶段

### 阶段 1：#1 source 节点过滤 — 状态：complete（采用方案 A）
- [x] 尝试对节点应用 `_matches_source_filters`
- [x] **发现**：此举破坏两个既有测试。`test_query_v1_and_or_semantics` 故意断言 source_id 不命中的节点仍保留 → 原设计**有意**让 source 过滤只作用于边。且 time 维度对无时间戳节点会全量误裁。
- [x] 已回退节点改动，#1 不是静默 bug 而是有意设计
- [x] **用户拍板：方案 A**——维持边过滤，UI 澄清。新增 `filter.hints.sourceFilters`（中英），在 Source 分组顶部渲染"仅作用于关系（边），不过滤节点"。

### 阶段 2：#2 meta 语义如实暴露 — 状态：complete
- [x] `execution_mode` 改为 `"post_truncation_filter"`
- [x] 新增 `meta.filtered_on_truncated_base`：`was_truncated_before and filtering_applied` 时为真
- [x] 前端：`GraphQueryMeta` 补字段；`useLightragGraph` 在该标志为真时弹更强警示 toast（复用现有截断 toast 链路，未改 Summary）
- [x] i18n：`graphPanel.filteredOnTruncatedBase`（中英）
- [x] 测试：截断+过滤为真、未截断为假、截断无过滤为假

### 阶段 3：验证 — 状态：complete
- [x] `uv run pytest tests/test_graph_workbench.py` → 19 passed
- [x] 前端 `bun test FilterWorkbench` → 12 passed；`tsc` 我改动文件无新增错误
- [x] `git diff` 自查：#2 改动最小，复用既有 toast 而非新增 Summary 状态线

## 挂起（后续单独立项）

- **#1 决策**：见决策记录。原设计 source 只过滤边。
- **#2 彻底版**：已选方案 C 并落地方案 A（filter-first 全量取数，后端无关）。详见 [2026-06-18-graph-filter-pushdown-design.md](2026-06-18-graph-filter-pushdown-design.md)。Nebula 谓词下推（方案 B）按需，待真实图压测。**附带修正 #4**（filter-first 路径度数真实）。
- #3 only_matched 多跳、#5 时区、#6 chips、#7 multiselect、#8 互斥、#9 预设/URL、#10 min/max 校验。

## 决策记录

| 决策                         | 选择                | 理由                                                                |
| ---------------------------- | ------------------- | ------------------------------------------------------------------- |
| #1 source 同时过滤节点和边？ | **推翻，待重定**    | 原设计有意只过滤边并有测试锁定；强行 AND 会破坏契约且 time 维度误裁无时间戳节点 |
| #2 本次做下推？              | 否                  | 跨后端、改动大；先诚实暴露止血，避免误判                            |
| 计划文档位置                 | `docs/aegis/plans/` | 根 `task_plan.md` 属另一进行中任务，不可覆盖                        |

## 遇到的错误

| 错误     | 尝试 | 解决 |
| -------- | ---- | ---- |
| #1 节点 source 过滤破坏 `test_query_v1_and_or_semantics` 与时区时间过滤测试 | 1 | 回退节点改动；确认原设计有意为之，转为向用户求决策 |
