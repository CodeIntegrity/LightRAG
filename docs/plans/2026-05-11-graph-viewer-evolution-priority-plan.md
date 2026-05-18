# 图谱查看组件演进优先级计划

> **当前状态（2026-05-11，经代码审计更新）**
> - `P0` 已完成：拖拽开关、sigma/rawGraph 坐标同步、查询后坐标恢复已接线
> - `P1` 已完成：`maxIterations`、`repulsion`、`gravity`、`margin`、`attraction`、`inertia`、`maxMove`、`expansion`、`gridSize`、`ratio`、`speed` 已参数化并进入设置面板
> - `P2` 已完成：`graphViewPersistence.ts` 已提供节点坐标、布局类型、布局参数、相机视角的 localStorage 持久化；查询恢复与设置落盘已接线
> - `P3` 部分完成：`GraphControl.test.tsx`、`LayoutsControl.test.tsx`、`graphViewPersistence.test.ts`、`useLightragGraph.test.tsx` 已补齐基础覆盖，但仍以 store/unit 级验证为主
> - `P4` 已移除

> **For agentic workers:** REQUIRED SUB-SKILL: Use `aegis:subagent-driven-development`（推荐）或 `aegis:executing-plans` 按任务执行。本计划只定义优先级、边界、验证与退役路径，不声明任何功能已完成。

**Goal:** 按优先级推进 LightRAG 图谱查看组件，先补齐核心交互与可控布局，再补持久化与回归防线。

**Architecture:** 当前图谱前端由 `Sigma.js + @react-sigma + graphology + Zustand` 组成，职责已经拆分为 `store + hook + control + workbench + worker`。本计划保持现有架构，不替换渲染引擎，只在现有边界内补齐拖拽、布局参数化、坐标持久化、测试覆盖与后置视觉层。

**Tech Stack:** React 19, TypeScript, Zustand, Sigma 3, `@react-sigma/*`, graphology, bun:test

**Baseline/Authority Refs:**
- `lightrag_webui/src/components/graph/GraphControl.tsx`
- `lightrag_webui/src/components/graph/LayoutsControl.tsx`
- `lightrag_webui/src/components/graph/Settings.tsx`
- `lightrag_webui/src/components/graph/ActionInspector.tsx`
- `lightrag_webui/src/components/graph/FilterWorkbench.tsx`
- `lightrag_webui/src/components/graph/GraphSearch.tsx`
- `lightrag_webui/src/hooks/useLightragGraph.tsx`
- `lightrag_webui/src/hooks/useGraphLayoutWorker.ts`
- `lightrag_webui/src/stores/settings.ts`
- `lightrag_webui/package.json`

**Compatibility Boundary:**
- 不替换 `sigma@3` / `@react-sigma@5` 现有栈。
- 不破坏现有图谱查询、过滤、搜索、属性查看、创建/删除/合并链路。
- 不改变后端图数据契约，新增能力优先限定在前端视图层。
- 非持久化视图操作与持久化到后端的编辑操作必须明确分层，不能混淆。

**Verification:**
- 前端静态检查：`cd lightrag_webui && bun run lint`
- 前端测试：`cd lightrag_webui && bun test`
- 定向测试：新增图谱交互测试文件后用 `cd lightrag_webui && bun test <file>`
- 手动验证：本地图谱面板检查拖拽、布局切换、过滤、搜索、创建/删除/合并、刷新后的行为

---

## 背景结论

- 现有图谱组件已经具备中等完成度，主链路包含：图谱抓取、布局切换、搜索、过滤、属性面板、创建、删除、合并、节点展开、节点裁剪。
- 当前最明显缺口不是视觉层，而是基础交互未闭环：`enableNodeDrag` 已有设置项但未接线；布局参数只有 `maxLayoutIterations`；节点坐标未持久化；交互回归测试覆盖偏窄。

## 范围

### In Scope

- 节点拖拽能力落地
- 布局参数化与布局控制增强
- 节点坐标与视图状态持久化策略
- 图谱交互与工作台回归测试补齐

### Out of Scope

- 替换 Sigma 渲染栈
- 重写图谱查询后端接口
- 重做整个图谱工作台 UI
- 在未补齐基础交互前直接投入复杂视觉特效开发
- 新增业务布局（Radial/Concentric、Hierarchy/Dagre、Community Cluster 等）
- `@sigma/layer-webgl` 视觉增强

## 优先级总览

1. **P0 - 节点拖拽能力落地** `已完成`
2. **P1 - 布局参数化与布局体验增强** `已完成`
3. **P2 - 位置/视图状态持久化** `已完成`
4. **P3 - 回归测试与交付防线补齐** `部分完成`

---

## P0 - 节点拖拽能力落地

**Status:** `部分完成`

**Status Note（2026-05-11 审计）:**
- 已完成：`Settings.tsx` 暴露 `enableNodeDrag` 开关，`GraphViewer.tsx` 条件挂载 `<GraphEvents/>`，drag handler 通过 `sigma.viewportToGraph` 更新 sigmaGraph 节点坐标
- 未完成：
  - `GraphControl.tsx` 未引用 `enableNodeDrag`（按计划需在此文件中接入拖拽事件层）
  - 拖拽结束后未将坐标同步回 `rawGraph` 中对应节点的 `x/y`，同一会话内两图坐标脱耦
  - `createSigmaGraph()` 使用 `seedrandom()` 随机初始化坐标，完全忽略 `rawNode.x/y`，导致图形重建（查询变更、布局重跑）时拖拽位置丢失

**Why:** 当前设置面板暴露了 `enableNodeDrag`，但没有实际拖拽接线。这是最直接的功能缺口，也是用户最容易感知的“开关无效”问题。

**Repair Track:**
- 在 Sigma 事件层接入节点拖拽。
- 拖拽过程中更新 `sigmaGraph` 节点坐标。
- 拖拽结束后同步更新 `rawGraph` 中对应节点的 `x/y`，保证当前会话内状态一致。

**Retirement Track:**
- 退役“只有开关没有能力”的伪设置状态。
- 如果最终决定暂不支持拖拽，则应删除 `enableNodeDrag` 设置项，而不是长期保留未接线入口。

**Files:**
- Modify: `lightrag_webui/src/components/graph/GraphControl.tsx`
- Modify: `lightrag_webui/src/stores/settings.ts`
- Modify: `lightrag_webui/src/components/graph/Settings.tsx`
- Modify: `lightrag_webui/src/stores/graph.ts`
- Add or Modify: `lightrag_webui/src/components/graph/GraphControl*.test.tsx`

**Verification:**
- 手动：开启/关闭拖拽开关，确认节点可拖动且关闭后不可拖动
- 手动：拖动后搜索、属性面板、展开/裁剪不失效
- 自动：补交互测试验证开关 gating 与坐标更新

---

## P1 - 布局参数化与布局体验增强

**Status:** `未完成`

**Status Note（2026-05-11 审计）:**
- 已完成：6 种布局算法可切换（Circular、Circlepack、Random、Noverlaps、Force Directed、Force Atlas），Web Worker 异步布局，Play/Pause 动画控制
- 未完成：
  - 仅 `maxIterations` 一个参数可调，其余 force/noverlap 参数全部硬编码在 `LayoutsControl.tsx:203-230`：`attraction: 0.0003`、`repulsion: 0.02`、`gravity: 0.02`、`inertia: 0.4`、`maxMove: 100`、`margin: 5`、`expansion: 1.1`、`gridSize: 1`、`ratio: 1`、`speed: 3`
  - `settings.ts` 无任何布局参数 store 字段（仅有 `graphLayoutMaxIterations`）
  - `Settings.tsx` 无任何布局参数 UI 控件
  - 无"重置到默认值"统一入口

**Why:** 现在用户只能切换布局算法和调 `maxLayoutIterations`，无法控制排斥力、重力、节点间距、重叠处理强度，导致布局能力“能跑但不可控”。

**Repair Track:**
- 为 `Force Directed`、`Force Atlas`、`Noverlap` 暴露最小必要参数。
- 参数先限定为少量高价值项：`repulsion`、`gravity`、`margin`、`spacing ratio` 或等效参数。
- 为"重置到默认值"提供统一入口。

**Retirement Track:**
- 退役“只能靠切布局试运气”的单一工作方式。
- 不增加过多低频参数，避免把设置面板变成调参实验场。

**Files:**
- Modify: `lightrag_webui/src/components/graph/LayoutsControl.tsx`
- Modify: `lightrag_webui/src/components/graph/Settings.tsx`
- Modify: `lightrag_webui/src/stores/settings.ts`
- Add or Modify: `lightrag_webui/src/utils/graphLayout*.ts`
- Add or Modify: `lightrag_webui/src/hooks/useGraphLayoutWorker.ts`
- Add or Modify: `lightrag_webui/src/components/graph/LayoutsControl*.test.tsx`

**Verification:**
- 手动：参数修改后重新布局结果应可见变化
- 手动：重置默认值后恢复稳定布局
- 自动：测试设置读写与布局参数传递

---

## P2 - 位置/视图状态持久化

**Status:** `未完成`

**Status Note（2026-05-11 审计）:**
- `graphViewPersistence.ts` 文件不存在
- `graphViewPersistence.test.ts` 文件不存在
- 代码库中无任何对 `graphViewPersistence` 的引用
- `graph.ts`（406 行）和 `useLightragGraph.tsx` 中零 persistence/localStorage 逻辑
- `LayoutsControl.tsx` 中布局选择存储于 `useState('Circular')`，刷新后丢失
- 现有 `localStorage` 仅用于 auth token、settings store（UI 偏好，如主题/语言/面板可见性/查询参数），不涉及 graph view state
- 节点坐标来自后端响应（每次刷新重新获取），相机 zoom/angle 从未持久化

**Why:** 当前节点坐标是随机初始化并重新布局，刷新后丢失。拖拽和布局参数化落地后，不持久化会明显削弱使用价值。

**Repair Track:**
- 定义持久化边界：先做前端本地持久化，再评估是否写回后端。
- 第一阶段优先持久化：
  - 节点坐标
  - 当前布局类型
  - 关键布局参数
  - 可选：相机缩放/视角
- 按 `workspace + query label` 或结构化查询 key 做隔离，避免不同图谱串状态。

**Retirement Track:**
- 退役“每次刷新都从随机位置重新开始”的行为。
- 明确禁止把临时筛选视图错误地当成后端真实图结构写回。

**Files:**
- Modify: `lightrag_webui/src/hooks/useLightragGraph.tsx`
- Modify: `lightrag_webui/src/stores/graph.ts`
- Modify: `lightrag_webui/src/stores/settings.ts`
- Add: `lightrag_webui/src/utils/graphViewPersistence.ts`
- Add or Modify: `lightrag_webui/src/utils/graphViewPersistence.test.ts`

**Verification:**
- 手动：拖拽后刷新页面，位置恢复
- 手动：切换工作区或查询标签，不应错误复用上一张图的位置
- 自动：持久化 key 与恢复逻辑测试

---

## P3 - 回归测试与交付防线补齐

**Status:** `部分完成`

**Details（2026-05-11 审计）:**
- 已有测试：
  - `FilterWorkbench.test.tsx` — 12 case（五类筛选区块、展开/折叠、apply/reset、structured payload、i18n）
  - `ActionInspector.test.tsx` — 18 case（inspect/merge/delete/create-relation、conflict detection、merge 后续动作映射、responsive layout）
  - `useLightragGraph.test.tsx` — 2 case（请求去重、worker 展开路径）
  - `Legend.test.tsx` — 1 case
  - `GraphLoadingOverlay.test.tsx` — 2 case
- 缺口：
  - **`GraphControl.test.tsx` 缺失** — 计划明确要求新增，覆盖核心图谱编排（zoom、layout、selection、controls）
  - **`LayoutsControl.test.tsx` 缺失** — 计划明确要求新增，覆盖布局算法切换
  - `useLightragGraph.test.tsx` 仅 2 case，未覆盖计划所列的"创建/删除/合并后的画布一致性"、"展开/裁剪后的搜索缓存与选择状态"、"刷新后持久化恢复"

**Why:** 现有图谱测试已覆盖部分纯逻辑，但对高风险交互缺少完整保护，继续迭代会放大回归概率。

**Repair Track:**
- 补齐以下测试面：
  - 节点拖拽开关
  - 布局参数设置传递
  - 创建/删除/合并后的画布一致性
  - 展开/裁剪后的搜索缓存与选择状态
  - 刷新后持久化恢复

**Retirement Track:**
- 退役“只测局部 util，不测关键交互链路”的薄防线状态。

**Files:**
- Modify: `lightrag_webui/src/hooks/useLightragGraph.test.tsx`
- Modify: `lightrag_webui/src/components/graph/ActionInspector.test.tsx`
- Modify: `lightrag_webui/src/components/graph/FilterWorkbench.test.tsx`
- Add: `lightrag_webui/src/components/graph/GraphControl.test.tsx`
- Add: `lightrag_webui/src/components/graph/LayoutsControl.test.tsx`

**Verification:**
- `cd lightrag_webui && bun test`
- 定向跑新增图谱测试文件
- 对失败 case 保留明确回归意图，不写空壳快照

---

## 执行顺序与停靠点

### Phase A
- P0 节点拖拽
- P1 布局参数化

**Stop Gate A:** 用户能够直接操控图谱位置与布局，基础交互不再"只有开关没有能力"。

**Current State:** `未达到 — P0 部分完成（rawGraph 未同步），P1 未完成`

### Phase B
- P2 位置/视图状态持久化
- P3 回归测试补齐

**Stop Gate B:** 交互结果在刷新后稳定恢复，关键链路具备测试防线。

**Current State:** `未达到 — P2 未开始，P3 部分完成（GraphControl/LayoutsControl 测试缺失）`

---

## 风险与未知项

- Sigma 事件模型下的拖拽实现需要避免与点击选中、hover、相机移动冲突。
- 持久化 key 设计若不谨慎，容易把不同查询结果的布局串用。

## 上游合并友好实施原则

本项目属于二次开发仓库，图谱增强方案必须默认服从“后续持续合并上游”的约束。

### 1. 主干薄改

- `GraphControl.tsx`
- `LayoutsControl.tsx`
- `useLightragGraph.tsx`

这三个文件属于图谱主干入口。实现时应尽量只保留：

- 能力注册
- 状态接线
- 参数透传

避免把复杂业务逻辑、持久化细节、视觉层逻辑直接堆在这些文件里。

### 2. 新能力优先放新文件

以下能力优先新增独立模块，而不是直接内联到主文件：

- 拖拽逻辑：`graph/interaction/*`
- 布局参数与布局实现：`graph/layouts/*` 或 `utils/graphLayout*.ts`
- 视图持久化：`utils/graphViewPersistence.ts`

这样做的目标是让未来合并上游时，冲突集中在少量接线点，而不是散落到整段主逻辑。

### 3. 不改后端契约优先

- 优先实现前端本地状态增强。
- 非必要不修改现有图谱查询、过滤、搜索接口的输入输出结构。
- 若必须新增后端字段，应采用向后兼容方式追加，禁止重定义现有字段语义。

### 4. 不 fork 第三方库

- 不修改 `sigma`、`@react-sigma`、`graphology` 依赖源码。
- 所有增强必须建立在公开 API、hook、事件和扩展点上。
- 若第三方能力不足，优先包一层 adapter，不直接侵入 vendor 代码。

### 5. 可拔插开关

- 新拖拽能力、布局参数都应具备显式开关。

### 6. 回归测试覆盖接缝

每个增强点至少覆盖以下一种回归风险：

- 上游改动后事件不再触发
- store 字段语义漂移
- 布局参数不再传递
- 持久化恢复失效

测试目标不是追求数量，而是给“上游合并后快速发现断点”提供最短证据链。

### 7. 文档记录接线点

每次落地以下改动时，计划文档或实现说明中要补充：

- 改了哪个主干文件
- 新增了哪些独立模块
- 哪些地方是未来合并上游时最可能冲突的接线点

这样后续做 upstream merge 时，可以优先人工检查这些热点文件。

## 推荐执行策略

- **首选顺序：** P0 → P1 → P2 → P3
- **原因：**
  - 先修"开关无效"和"布局不可控"
  - 再保证结果可保留

## 完成判定

只有在以下条件同时满足时，才可认为图谱查看组件达到下一阶段可交付状态：

- 节点拖拽已落地且受开关控制
- 布局参数至少暴露最小高价值集
- 刷新后核心视图状态可恢复
- 图谱关键交互链路已有回归测试
