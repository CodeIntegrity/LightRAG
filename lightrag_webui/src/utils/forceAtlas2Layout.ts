import type Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import noverlap from 'graphology-layout-noverlap'
import circlepack from 'graphology-layout/circlepack'

/**
 * 自适应的 ForceAtlas2 两阶段布局工具。
 *
 * 解决"节点过多时全挤在一起"的核心思路：
 * 1. 用 inferSettings 让性能参数（barnesHutOptimize / slowDown）随节点规模自适应；
 * 2. 用 LinLog 模型 + outboundAttractionDistribution 让社区/簇明显分离、弱化 hub 吸附；
 * 3. 用 adjustSizes 顾及节点半径做反碰撞（barnesHut 关闭时直接生效，即默认 ≤2000 节点）；
 * 4. 再跑一遍 noverlap 按节点 size 抛光，消除残余重叠（弥补大图 barnesHut 下 adjustSizes 失效）。
 *
 * "布局聚集"（clusterAttribute）独立于着色：指定一个节点属性（如 entityType 或 community），
 * 布局前按该属性分扇区做初始种子，FA2 收敛后同属性节点聚成明显的团；circlepack 则按该属性打包成气泡。
 */

/** 布局聚集依据：不聚集 / 按实体类型 / 按社区 */
export type GraphClusterBy = 'none' | 'type' | 'community'

/** 把聚集依据映射到节点上的属性名（type→entityType，community→community） */
export function resolveClusterAttribute(clusterBy: GraphClusterBy): string | undefined {
  if (clusterBy === 'type') return 'entityType'
  if (clusterBy === 'community') return 'community'
  return undefined
}

// 迭代次数随节点规模线性放大并夹在合理区间，避免死守过低的默认值导致无法收敛
export const AUTO_LAYOUT_MIN_ITERATIONS = 80
export const AUTO_LAYOUT_MAX_ITERATIONS = 400

export function resolveAutoLayoutIterations(order: number): number {
  const scaled = 60 + Math.round(order * 0.5)
  return Math.min(AUTO_LAYOUT_MAX_ITERATIONS, Math.max(AUTO_LAYOUT_MIN_ITERATIONS, scaled))
}

/** FA2 展开强度默认值（越大越松散） */
export const DEFAULT_FA2_SCALING_RATIO = 1
/** FA2 向心力默认值（越大越向中心聚拢） */
export const DEFAULT_FA2_GRAVITY = 1

/**
 * 不依赖 graph 实例的 FA2 模型参数，供 react-sigma 的连续布局 hook 直接使用。
 * LinLog 模型需要配套的小 scalingRatio 与正常 gravity。
 */
export const FORCE_ATLAS2_BASE_SETTINGS: Record<string, unknown> = {
  linLogMode: true,
  outboundAttractionDistribution: true,
  adjustSizes: true,
  scalingRatio: DEFAULT_FA2_SCALING_RATIO,
  gravity: DEFAULT_FA2_GRAVITY,
  strongGravityMode: false
}

/**
 * 生成兼顾"自适应规模"与"清晰簇分离"的 ForceAtlas2 settings。
 * 覆盖 inferSettings 的标准模型取值为 LinLog 配套参数，
 * 但保留其随规模自适应的 barnesHutOptimize / slowDown。
 * overrides 让 scalingRatio（展开强度）与 gravity（向心力）由用户设置驱动。
 */
export function resolveForceAtlas2Settings(
  graph: Graph,
  overrides?: { scalingRatio?: number; gravity?: number }
): Record<string, unknown> {
  const inferred = forceAtlas2.inferSettings(graph) as Record<string, unknown>
  return {
    ...inferred,
    ...FORCE_ATLAS2_BASE_SETTINGS,
    ...(overrides?.scalingRatio !== undefined ? { scalingRatio: overrides.scalingRatio } : {}),
    ...(overrides?.gravity !== undefined ? { gravity: overrides.gravity } : {})
  }
}

export interface ForceAtlas2LayoutOptions {
  /** FA2 迭代次数，缺省按节点数自适应 */
  iterations?: number
  /** noverlap 抛光迭代次数 */
  noverlapIterations?: number
  /** noverlap 节点间距余量 */
  noverlapMargin?: number
  /** 按该节点属性做初始分簇种子，让 FA2 收敛后同属性节点聚集成团（缺省不聚集） */
  clusterAttribute?: string
  /** FA2 展开强度（越大越松散），缺省 1 */
  scalingRatio?: number
  /** FA2 向心力（越大越向中心聚拢），缺省 1 */
  gravity?: number
  /** 先把节点铺成均匀圆盘再跑 FA2，给收敛留出空间（首屏布局用，避免初始挤成一团） */
  scatterInitial?: boolean
}

function hashStringToUnitInterval(value: string, salt: number): number {
  let hash = 2166136261 ^ salt
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

/** 读取节点 size 属性（缺省 4，与其余视图一致），用于按节点半径估算布局尺度 */
function getNodeSize(graph: Graph, nodeId: string): number {
  const size = graph.getNodeAttribute(nodeId, 'size')
  return typeof size === 'number' ? size : 4
}

/** 用 noverlap 按节点 size 抛光消除重叠；margin 为节点间额外间距余量 */
function relaxOverlappingNodes(graph: Graph, options: { margin?: number } = {}): void {
  noverlap.assign(graph, {
    maxIterations: 120,
    settings: {
      margin: options.margin ?? 3,
      ratio: 1,
      expansion: 1.1,
      gridSize: 20
    }
  })
}

export function applyInitialRandomLayout(graph: Graph): void {
  if (!graph || graph.order === 0) return

  const nodeIds = graph.nodes()
  const maxSize = nodeIds.reduce((max, nodeId) => Math.max(max, getNodeSize(graph, nodeId)), 1)
  const scale = Math.max(40, Math.sqrt(graph.order) * maxSize * 6)
  const offset = scale / 2

  nodeIds.forEach((nodeId) => {
    graph.setNodeAttribute(nodeId, 'x', hashStringToUnitInterval(nodeId, 0) * scale - offset)
    graph.setNodeAttribute(nodeId, 'y', hashStringToUnitInterval(nodeId, 1) * scale - offset)
  })

  relaxOverlappingNodes(graph, { margin: 3 })
}

/**
 * 按指定属性给初始坐标：每组放到一个大圆的扇区中心，组内节点再排成小圆。
 * FA2 从这个"已分簇"的初始态收敛，从而让同属性节点在空间上聚集成团。
 */
function seedPositionsByAttribute(graph: Graph, attribute: string): void {
  const groups = new Map<string, string[]>()
  graph.forEachNode((node) => {
    const value = graph.getNodeAttribute(node, attribute)
    const key = value === undefined || value === null ? '__none__' : String(value)
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(node)
    } else {
      groups.set(key, [node])
    }
  })

  const keys = Array.from(groups.keys())
  const k = keys.length
  if (k === 0) return

  // 组中心分布在大圆上，半径随组数放大以拉开组间距
  const outerRadius = Math.max(20, k * 6)

  keys.forEach((key, index) => {
    const centerAngle = (2 * Math.PI * index) / k
    const cx = Math.cos(centerAngle) * outerRadius
    const cy = Math.sin(centerAngle) * outerRadius
    const members = groups.get(key)!
    const innerRadius = Math.max(1, Math.sqrt(members.length))
    members.forEach((node, j) => {
      const a = (2 * Math.PI * j) / Math.max(members.length, 1)
      graph.setNodeAttribute(node, 'x', cx + Math.cos(a) * innerRadius)
      graph.setNodeAttribute(node, 'y', cy + Math.sin(a) * innerRadius)
    })
  })
}

/**
 * 用黄金角螺旋（向日葵排布）把节点均匀铺满一个圆盘，半径随节点数放大。
 * 给 FA2 一个有间距的初始态，避免从 [0,1) 种子小方块出发收敛不开、节点挤成一团。
 */
function scatterInitialPositions(graph: Graph): void {
  const n = graph.order
  if (n === 0) return
  const radius = Math.max(10, Math.sqrt(n) * 10)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  let i = 0
  graph.forEachNode((node) => {
    const angle = i * goldenAngle
    const r = radius * Math.sqrt((i + 0.5) / n)
    graph.setNodeAttribute(node, 'x', Math.cos(angle) * r)
    graph.setNodeAttribute(node, 'y', Math.sin(angle) * r)
    i++
  })
}

/**
 * 把收敛到同一坐标的节点扇形散开。
 *
 * FA2（尤其 LinLog + 向心力）会把孤立/弱连接节点拉到完全相同的点上，而 noverlap 的
 * 反碰撞依赖节点间距方向，对"零距离重合点"无法施力 → 这些节点永远分不开，表现为
 * "大量节点挤在一个点"。这里按坐标分桶，把同一点上的多个节点用黄金角螺旋铺成小圆盘，
 * 既打破重合又预先散开，交给后续 noverlap 完成正式间距。
 */
function separateCoincidentNodes(graph: Graph): void {
  const buckets = new Map<string, string[]>()
  graph.forEachNode((node) => {
    const x = graph.getNodeAttribute(node, 'x') as number
    const y = graph.getNodeAttribute(node, 'y') as number
    const key = `${Math.round(x * 100)}:${Math.round(y * 100)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(node)
    else buckets.set(key, [node])
  })

  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  buckets.forEach((members) => {
    if (members.length < 2) return
    const cx = graph.getNodeAttribute(members[0], 'x') as number
    const cy = graph.getNodeAttribute(members[0], 'y') as number
    const spread = Math.max(1, Math.sqrt(members.length))
    members.forEach((node, index) => {
      const angle = index * goldenAngle
      const r = spread * Math.sqrt((index + 0.5) / members.length)
      graph.setNodeAttribute(node, 'x', cx + Math.cos(angle) * r)
      graph.setNodeAttribute(node, 'y', cy + Math.sin(angle) * r)
    })
  })
}

/**
 * 原地应用两阶段布局（直接修改 graph 的 x/y）。供首屏自动布局使用。
 */
export function applyForceAtlas2Layout(
  graph: Graph,
  options: ForceAtlas2LayoutOptions = {}
): void {
  if (!graph || graph.order === 0) return

  if (options.clusterAttribute) {
    seedPositionsByAttribute(graph, options.clusterAttribute)
  } else if (options.scatterInitial) {
    scatterInitialPositions(graph)
  }

  const iterations = options.iterations ?? resolveAutoLayoutIterations(graph.order)
  forceAtlas2.assign(graph, {
    iterations,
    settings: resolveForceAtlas2Settings(graph, {
      scalingRatio: options.scalingRatio,
      gravity: options.gravity
    })
  })

  // 散开 FA2 留下的重合节点，否则 noverlap 对它们无能为力
  separateCoincidentNodes(graph)

  noverlap.assign(graph, {
    maxIterations: options.noverlapIterations ?? 120,
    settings: {
      margin: options.noverlapMargin ?? 3,
      ratio: 1,
      expansion: 1.1,
      gridSize: 20
    }
  })
}

/**
 * 快照当前坐标 → 原地布局 → 读出结果 → 还原快照，便于调用方做动画过渡。
 */
function computeWithSnapshot(
  graph: Graph,
  assign: (graph: Graph) => void
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  if (!graph || graph.order === 0) return positions

  const snapshot: Record<string, { x: number; y: number }> = {}
  graph.forEachNode((node, attr) => {
    snapshot[node] = { x: attr.x as number, y: attr.y as number }
  })

  assign(graph)

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

/**
 * 计算两阶段布局后的目标坐标，但不永久改动 graph。
 */
export function computeForceAtlas2Layout(
  graph: Graph,
  options: ForceAtlas2LayoutOptions = {}
): Record<string, { x: number; y: number }> {
  return computeWithSnapshot(graph, (g) => applyForceAtlas2Layout(g, options))
}

/**
 * 按指定属性分组的 circlepack：每组打包成一个圆形气泡，气泡平铺。
 * 同样快照→assign→还原，便于调用方动画过渡。
 */
export function computeClusteredCirclepack(
  graph: Graph,
  attribute: string
): Record<string, { x: number; y: number }> {
  return computeWithSnapshot(graph, (g) => {
    circlepack.assign(g, { hierarchyAttributes: [attribute] })
  })
}
