import type Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import noverlap from 'graphology-layout-noverlap'

/**
 * 自适应的 ForceAtlas2 两阶段布局工具。
 *
 * 解决"节点过多时全挤在一起"的核心思路：
 * 1. 用 inferSettings 让性能参数（barnesHutOptimize / slowDown）随节点规模自适应；
 * 2. 用 LinLog 模型 + outboundAttractionDistribution 让社区/簇明显分离、弱化 hub 吸附；
 * 3. 用 adjustSizes 顾及节点半径做反碰撞（barnesHut 关闭时直接生效，即默认 ≤2000 节点）；
 * 4. 再跑一遍 noverlap 按节点 size 抛光，消除残余重叠（弥补大图 barnesHut 下 adjustSizes 失效）。
 */

// 迭代次数随节点规模线性放大并夹在合理区间，避免死守过低的默认值导致无法收敛
export const AUTO_LAYOUT_MIN_ITERATIONS = 80
export const AUTO_LAYOUT_MAX_ITERATIONS = 400

export function resolveAutoLayoutIterations(order: number): number {
  const scaled = 60 + Math.round(order * 0.5)
  return Math.min(AUTO_LAYOUT_MAX_ITERATIONS, Math.max(AUTO_LAYOUT_MIN_ITERATIONS, scaled))
}

/**
 * 不依赖 graph 实例的 FA2 模型参数，供 react-sigma 的连续布局 hook 直接使用。
 * LinLog 模型需要配套的小 scalingRatio 与正常 gravity。
 */
export const FORCE_ATLAS2_BASE_SETTINGS: Record<string, unknown> = {
  linLogMode: true,
  outboundAttractionDistribution: true,
  adjustSizes: true,
  scalingRatio: 1,
  gravity: 1,
  strongGravityMode: false
}

/**
 * 生成兼顾"自适应规模"与"清晰簇分离"的 ForceAtlas2 settings。
 * 覆盖 inferSettings 的标准模型取值为 LinLog 配套参数，
 * 但保留其随规模自适应的 barnesHutOptimize / slowDown。
 */
export function resolveForceAtlas2Settings(graph: Graph): Record<string, unknown> {
  const inferred = forceAtlas2.inferSettings(graph) as Record<string, unknown>
  return {
    ...inferred,
    ...FORCE_ATLAS2_BASE_SETTINGS
  }
}

export interface ForceAtlas2LayoutOptions {
  /** FA2 迭代次数，缺省按节点数自适应 */
  iterations?: number
  /** noverlap 抛光迭代次数 */
  noverlapIterations?: number
  /** noverlap 节点间距余量 */
  noverlapMargin?: number
}

/**
 * 原地应用两阶段布局（直接修改 graph 的 x/y）。供首屏自动布局使用。
 */
export function applyForceAtlas2Layout(
  graph: Graph,
  options: ForceAtlas2LayoutOptions = {}
): void {
  if (!graph || graph.order === 0) return

  const iterations = options.iterations ?? resolveAutoLayoutIterations(graph.order)
  forceAtlas2.assign(graph, {
    iterations,
    settings: resolveForceAtlas2Settings(graph)
  })

  noverlap.assign(graph, {
    maxIterations: options.noverlapIterations ?? 80,
    settings: {
      margin: options.noverlapMargin ?? 3,
      ratio: 1,
      expansion: 1.1,
      gridSize: 20
    }
  })
}

/**
 * 计算两阶段布局后的目标坐标，但不永久改动 graph，便于调用方做动画过渡。
 * 内部先快照当前坐标 → 原地布局 → 读出结果 → 还原快照。
 */
export function computeForceAtlas2Layout(
  graph: Graph,
  options: ForceAtlas2LayoutOptions = {}
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  if (!graph || graph.order === 0) return positions

  const snapshot: Record<string, { x: number; y: number }> = {}
  graph.forEachNode((node, attr) => {
    snapshot[node] = { x: attr.x as number, y: attr.y as number }
  })

  applyForceAtlas2Layout(graph, options)

  graph.forEachNode((node, attr) => {
    positions[node] = { x: attr.x as number, y: attr.y as number }
  })

  // 还原坐标，让调用方从原位置动画到目标位置
  for (const node in snapshot) {
    if (!graph.hasNode(node)) continue
    graph.setNodeAttribute(node, 'x', snapshot[node].x)
    graph.setNodeAttribute(node, 'y', snapshot[node].y)
  }

  return positions
}
