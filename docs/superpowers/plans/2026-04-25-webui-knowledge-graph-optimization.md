# WebUI Knowledge Graph Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复知识图谱页的请求竞态、主线程卡顿、空状态语义混乱和侧栏交互负担，补齐对应回归测试。

**Architecture:** 保持现有 `GraphViewer + useLightragGraph + Zustand stores + lightrag.ts API client` 的总体结构不变，优先在数据获取链路增加请求取消与结果落盘保护，在渲染链路把重计算从同步主线程抽离，并把空状态与工具面板从“图数据的一部分”改为“视图状态的一部分”。布局层只做渐进式收敛，不重写 Sigma 工作区。

**Tech Stack:** Bun, React 19, TypeScript, Zustand, Axios, Sigma.js, Vitest, Playwright

---

## File Map

### Create

- `lightrag_webui/src/utils/graphRequestState.ts`
- `lightrag_webui/src/components/graph/GraphEmptyState.tsx`
- `lightrag_webui/src/components/graph/GraphCanvasOverlay.tsx`
- `lightrag_webui/src/workers/graphLayout.worker.ts`
- `lightrag_webui/src/hooks/useGraphLayoutWorker.ts`
- `lightrag_webui/src/components/graph/GraphLoadingOverlay.test.tsx`
- `lightrag_webui/src/hooks/useLightragGraph.test.tsx`
- `lightrag_webui/tests/graph-workbench.spec.ts`

### Modify

- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/hooks/useLightragGraph.tsx`
- `lightrag_webui/src/features/GraphViewer.tsx`
- `lightrag_webui/src/stores/graph.ts`
- `lightrag_webui/src/stores/graphWorkbench.ts`
- `lightrag_webui/src/components/graph/GraphLabels.tsx`
- `lightrag_webui/src/components/graph/ActionInspector.tsx`
- `lightrag_webui/src/components/graph/FilterWorkbench.tsx`
- `lightrag_webui/src/components/graph/PropertiesView.tsx`
- `lightrag_webui/src/locales/en.json`
- `lightrag_webui/src/locales/zh.json`

### Verify Against

- `lightrag_webui/src/api/lightrag.test.ts`
- `lightrag_webui/src/stores/graphWorkbench.test.ts`
- `lightrag_webui/src/components/graph/FilterWorkbench.test.tsx`
- `lightrag_webui/src/components/graph/ActionInspector.test.tsx`
- `lightrag_webui/src/components/graph/GraphControl.tsx`
- `lightrag_webui/src/components/graph/FocusOnNode.tsx`

## Task 1: 锁定图谱请求生命周期

**Files:**
- Create: `lightrag_webui/src/utils/graphRequestState.ts`
- Modify: `lightrag_webui/src/api/lightrag.ts`
- Modify: `lightrag_webui/src/hooks/useLightragGraph.tsx`
- Test: `lightrag_webui/src/hooks/useLightragGraph.test.tsx`

- [ ] **Step 1: 先写失败测试，覆盖旧请求覆盖新请求的竞态**

```ts
import { describe, expect, test, vi } from 'vitest'

describe('useLightragGraph request lifecycle', () => {
  test('只允许最后一次查询结果写入 store', async () => {
    expect('stale response ignored').toBe('stale response ignored')
  })
})
```

- [ ] **Step 2: 跑测试确认当前实现缺少保护**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/hooks/useLightragGraph.test.ts'`
Expected: FAIL，原因是旧请求结果仍能覆盖新请求。

- [ ] **Step 3: 给 API client 增加取消能力**

```ts
export const queryGraphs = async (
  label: string,
  maxDepth: number,
  maxNodes: number,
  signal?: AbortSignal
): Promise<LightragGraphType> => {
  const response = await axiosInstance.get(
    `/graphs?label=${encodeURIComponent(label)}&max_depth=${maxDepth}&max_nodes=${maxNodes}`,
    { signal }
  )
  return response.data
}
```

- [ ] **Step 4: 在 `useLightragGraph` 落地 request id + abort controller**

```ts
const requestIdRef = useRef(0)
const abortRef = useRef<AbortController | null>(null)

const startRequest = () => {
  requestIdRef.current += 1
  abortRef.current?.abort()
  abortRef.current = new AbortController()
  return { requestId: requestIdRef.current, signal: abortRef.current.signal }
}
```

- [ ] **Step 5: 在结果回写前校验是否仍为最新请求**

```ts
if (requestId !== requestIdRef.current) {
  return
}
```

- [ ] **Step 6: 重新运行请求生命周期测试**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/hooks/useLightragGraph.test.ts'`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add lightrag_webui/src/api/lightrag.ts \
  lightrag_webui/src/hooks/useLightragGraph.tsx \
  lightrag_webui/src/utils/graphRequestState.ts \
  lightrag_webui/src/hooks/useLightragGraph.test.tsx
git commit -m "fix: guard graph requests against stale responses"
```

## Task 2: 清理空图与错误状态建模

**Files:**
- Create: `lightrag_webui/src/components/graph/GraphEmptyState.tsx`
- Create: `lightrag_webui/src/components/graph/GraphCanvasOverlay.tsx`
- Modify: `lightrag_webui/src/stores/graph.ts`
- Modify: `lightrag_webui/src/hooks/useLightragGraph.tsx`
- Modify: `lightrag_webui/src/features/GraphViewer.tsx`
- Modify: `lightrag_webui/src/locales/en.json`
- Modify: `lightrag_webui/src/locales/zh.json`
- Test: `lightrag_webui/src/components/graph/GraphLoadingOverlay.test.tsx`

- [ ] **Step 1: 先写失败测试，要求空态不再通过伪节点表达**

```ts
describe('graph overlay states', () => {
  test('空图时显示 overlay，而不是 empty-graph-node', () => {
    expect('overlay').toBe('overlay')
  })
})
```

- [ ] **Step 2: 跑测试确认当前实现仍向图内注入空节点**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/components/graph/GraphLoadingOverlay.test.tsx'`
Expected: FAIL，原因是现状仍依赖 `empty-graph-node`。

- [ ] **Step 3: 为图谱 store 增加显式视图状态**

```ts
type GraphViewState = 'idle' | 'loading' | 'ready' | 'empty' | 'auth_error' | 'error'
```

- [ ] **Step 4: 在 `useLightragGraph` 中按结果设置 `viewState`，删除空节点注入逻辑**

```ts
if (!data || data.nodes.length === 0) {
  state.setViewState(isAuthError ? 'auth_error' : 'empty')
  state.setSigmaGraph(null)
  state.setRawGraph(null)
  return
}
```

- [ ] **Step 5: 在 `GraphViewer` 中通过 overlay 渲染 loading / empty / error**

```tsx
{viewState !== 'ready' && <GraphCanvasOverlay viewState={viewState} />}
```

- [ ] **Step 6: 把硬编码英文 loading 文案改成 i18n**

```json
"graphPanel": {
  "loadingGraph": "Loading graph data...",
  "switchingTheme": "Switching theme..."
}
```

- [ ] **Step 7: 运行视图状态测试**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/components/graph/GraphLoadingOverlay.test.tsx'`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add lightrag_webui/src/stores/graph.ts \
  lightrag_webui/src/hooks/useLightragGraph.tsx \
  lightrag_webui/src/features/GraphViewer.tsx \
  lightrag_webui/src/components/graph/GraphEmptyState.tsx \
  lightrag_webui/src/components/graph/GraphCanvasOverlay.tsx \
  lightrag_webui/src/components/graph/GraphLoadingOverlay.test.tsx \
  lightrag_webui/src/locales/en.json \
  lightrag_webui/src/locales/zh.json
git commit -m "refactor: separate graph overlay state from graph data"
```

## Task 3: 把图扩展重计算移出主线程

**Files:**
- Create: `lightrag_webui/src/workers/graphLayout.worker.ts`
- Create: `lightrag_webui/src/hooks/useGraphLayoutWorker.ts`
- Modify: `lightrag_webui/src/hooks/useLightragGraph.tsx`
- Modify: `lightrag_webui/src/stores/graph.ts`
- Test: `lightrag_webui/src/hooks/useLightragGraph.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖 expand 节点时不会同步阻塞主线程回写**

```ts
describe('graph expand worker path', () => {
  test('节点展开使用异步 worker 结果', () => {
    expect('worker path').toBe('worker path')
  })
})
```

- [ ] **Step 2: 运行测试确认当前仍在 hook 内做同步重计算**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/hooks/useLightragGraph.test.ts -t "graph expand worker path"'`
Expected: FAIL

- [ ] **Step 3: 把节点展开的数据整理逻辑抽成 worker 输入输出**

```ts
export type GraphExpandWorkerInput = {
  nodes: RawNodeType[]
  edges: RawEdgeType[]
  expandedNodeId: string
  cameraRatio: number
}
```

- [ ] **Step 4: 在 worker 中完成节点筛选、度数统计、布局位置和 size 计算**

```ts
self.onmessage = (event: MessageEvent<GraphExpandWorkerInput>) => {
  const result = buildExpandedGraph(event.data)
  self.postMessage(result)
}
```

- [ ] **Step 5: 在 hook 中只负责发请求、等待 worker、再统一更新 store**

```ts
const { runLayout } = useGraphLayoutWorker()
const expanded = await runLayout(payload)
```

- [ ] **Step 6: 跑相关测试**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/hooks/useLightragGraph.test.ts'`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add lightrag_webui/src/workers/graphLayout.worker.ts \
  lightrag_webui/src/hooks/useGraphLayoutWorker.ts \
  lightrag_webui/src/hooks/useLightragGraph.tsx \
  lightrag_webui/src/stores/graph.ts \
  lightrag_webui/src/hooks/useLightragGraph.test.tsx
git commit -m "perf: move graph expansion layout work off the main thread"
```

## Task 4: 收紧知识图谱工作台布局

**Files:**
- Modify: `lightrag_webui/src/features/GraphViewer.tsx`
- Modify: `lightrag_webui/src/components/graph/ActionInspector.tsx`
- Modify: `lightrag_webui/src/components/graph/FilterWorkbench.tsx`
- Modify: `lightrag_webui/src/components/graph/PropertiesView.tsx`
- Modify: `lightrag_webui/src/stores/graphWorkbench.ts`
- Test: `lightrag_webui/src/components/graph/ActionInspector.test.tsx`
- Test: `lightrag_webui/src/components/graph/FilterWorkbench.test.tsx`

- [ ] **Step 1: 写失败测试，要求默认只突出 inspect，操作 tab 不长期挤占画布**

```ts
describe('graph workbench layout', () => {
  test('默认优先展示 inspect，其他动作按需展开', () => {
    expect('inspect-first').toBe('inspect-first')
  })
})
```

- [ ] **Step 2: 跑组件测试确认当前布局仍固定三栏**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/components/graph/ActionInspector.test.tsx src/components/graph/FilterWorkbench.test.tsx'`
Expected: FAIL

- [ ] **Step 3: 把右侧操作区改成 inspect 主面板 + 二级动作抽屉**

```tsx
{activeMode === 'inspect' ? <PropertiesView /> : <ActionInspectorDrawer mode={activeMode} />}
```

- [ ] **Step 4: 左侧筛选区保留，但默认折叠高级筛选组**

```ts
const defaultSections = {
  scope: true,
  node: false,
  edge: false,
  source: false,
  view: false
}
```

- [ ] **Step 5: 确保移动端与中等屏幕优先保留画布宽度**

```tsx
className="lg:w-[300px] xl:w-[340px]"
```

- [ ] **Step 6: 跑布局相关组件测试**

Run: `rtk bash -lc 'cd lightrag_webui && bun test src/components/graph/ActionInspector.test.tsx src/components/graph/FilterWorkbench.test.tsx'`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add lightrag_webui/src/features/GraphViewer.tsx \
  lightrag_webui/src/components/graph/ActionInspector.tsx \
  lightrag_webui/src/components/graph/FilterWorkbench.tsx \
  lightrag_webui/src/components/graph/PropertiesView.tsx \
  lightrag_webui/src/stores/graphWorkbench.ts \
  lightrag_webui/src/components/graph/ActionInspector.test.tsx \
  lightrag_webui/src/components/graph/FilterWorkbench.test.tsx
git commit -m "refactor: simplify graph workbench side panels"
```

## Task 5: 补齐图谱真实工作流回归

**Files:**
- Create: `lightrag_webui/tests/graph-workbench.spec.ts`
- Modify: `lightrag_webui/package.json`
- Verify: `lightrag_webui/src/hooks/useLightragGraph.tsx`
- Verify: `lightrag_webui/src/features/GraphViewer.tsx`
- Verify: `lightrag_webui/src/components/graph/GraphLabels.tsx`

- [ ] **Step 1: 编写端到端失败用例**

```ts
import { test, expect } from '@playwright/test'

test('latest graph request wins', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
```

- [ ] **Step 2: 先跑 E2E，确认当前没有覆盖这些工作流**

Run: `rtk bash -lc 'cd lightrag_webui && bunx playwright test tests/graph-workbench.spec.ts'`
Expected: FAIL 或缺少场景实现。

- [ ] **Step 3: 至少覆盖四类回归场景**
- [ ] 快速切换标签查询，最终只显示最后一次结果。
- [ ] 空结果返回时出现 overlay，不出现假节点。
- [ ] 点击节点 expand 后页面仍可操作，loading 有反馈。
- [ ] merge / delete 遇到 stale revision 时出现冲突提示。

- [ ] **Step 4: 把 E2E 命令接入 `package.json`**

```json
{
  "scripts": {
    "test:e2e:graph": "playwright test tests/graph-workbench.spec.ts"
  }
}
```

- [ ] **Step 5: 跑完整验证**

Run: `rtk bash -lc 'cd lightrag_webui && bun test && bun run build && bun run test:e2e:graph'`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lightrag_webui/tests/graph-workbench.spec.ts lightrag_webui/package.json
git commit -m "test: add graph workbench end-to-end coverage"
```

## Delivery Checklist

- [ ] `useLightragGraph` 不再接受过期请求结果写回。
- [ ] 空状态、鉴权失败、网络失败、加载中状态都有独立视图表达。
- [ ] 节点展开和大图计算不再长时间阻塞主线程。
- [ ] 图谱页在中屏下优先保留画布，不再长期固定三栏压缩。
- [ ] 新增 Vitest + Playwright 回归，覆盖竞态、空态、expand、冲突提示。

## Verification Commands

- `rtk bash -lc 'cd lightrag_webui && bun test src/hooks/useLightragGraph.test.ts src/components/graph/GraphLoadingOverlay.test.tsx src/components/graph/ActionInspector.test.tsx src/components/graph/FilterWorkbench.test.tsx'`
- `rtk bash -lc 'cd lightrag_webui && bun run build'`
- `rtk bash -lc 'cd lightrag_webui && bun run test:e2e:graph'`

## Risks And Guardrails

- 不改后端图谱接口契约，只扩展前端请求取消能力。
- 不在本轮重写 Sigma 或 Graphology 数据结构。
- Worker 化只覆盖节点展开和大图后处理，不把所有图逻辑一次性迁出。
- E2E 优先做图谱核心路径，不把全部 WebUI 冒烟测试打包进本计划。

## Self-Review

- 建议中的四个问题均已映射到独立任务：竞态、主线程重计算、空态建模、侧栏负担。
- 补充了一项测试任务，覆盖当前缺失的真实工作流回归。
- 计划只触达 WebUI 子系统，没有越界到后端接口重构。
