import type Graph from 'graphology'

/**
 * 同心环辐射布局。
 *
 * 以一个中心节点为原点，按到中心的最短跳数（BFS 层级）把节点分到一圈圈同心环上：
 * 第 k 层节点放在半径 k×ringGap 的环上，层内按角度均分。节点铺满二维圆盘而非
 * 挤在一条圆环线上，相机适配后间距远好于单环 Circular 布局，能明显减少互相干涉。
 *
 * 与中心不连通的节点统一放到最外圈之外的一圈，避免和有效层级混叠。
 */
export interface RadialLayoutOptions {
  /** 中心节点 id；缺省取度数最大的节点 */
  center?: string | null
  /** 相邻环之间的半径间距 */
  ringGap?: number
}

export function computeRadialLayout(
  graph: Graph,
  options: RadialLayoutOptions = {}
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  if (!graph || graph.order === 0) return positions

  // 选中心：指定的有效节点，否则度数最大的节点
  let center: string | null =
    options.center && graph.hasNode(options.center) ? options.center : null
  if (!center) {
    let maxDegree = -1
    graph.forEachNode((node) => {
      const degree = graph.degree(node)
      if (degree > maxDegree) {
        maxDegree = degree
        center = node
      }
    })
  }
  if (!center) return positions

  const ringGap = options.ringGap ?? 10

  // BFS 计算每个节点到中心的跳数
  const depth = new Map<string, number>()
  depth.set(center, 0)
  let frontier: string[] = [center]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const node of frontier) {
      const nextDepth = depth.get(node)! + 1
      graph.forEachNeighbor(node, (neighbor) => {
        if (!depth.has(neighbor)) {
          depth.set(neighbor, nextDepth)
          next.push(neighbor)
        }
      })
    }
    frontier = next
  }

  // 未连通到中心的节点放到最外圈之外的一圈
  let maxDepth = 0
  depth.forEach((d) => {
    if (d > maxDepth) maxDepth = d
  })
  const orphanDepth = maxDepth + 1

  // 按层分组
  const rings = new Map<number, string[]>()
  graph.forEachNode((node) => {
    const ring = depth.has(node) ? depth.get(node)! : orphanDepth
    const bucket = rings.get(ring)
    if (bucket) bucket.push(node)
    else rings.set(ring, [node])
  })

  // 逐环按角度均分；中心层放在原点
  rings.forEach((members, ring) => {
    if (ring === 0) {
      members.forEach((node) => {
        positions[node] = { x: 0, y: 0 }
      })
      return
    }
    const radius = ring * ringGap
    const count = members.length
    members.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / count
      positions[node] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      }
    })
  })

  return positions
}
