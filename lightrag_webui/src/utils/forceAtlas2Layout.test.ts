import { describe, expect, test } from 'vitest'
import Graph from 'graphology'

import {
  AUTO_LAYOUT_MAX_ITERATIONS,
  AUTO_LAYOUT_MIN_ITERATIONS,
  applyForceAtlas2Layout,
  computeForceAtlas2Layout,
  resolveAutoLayoutIterations,
  resolveForceAtlas2Settings
} from '@/utils/forceAtlas2Layout'

const buildGraph = (nodeCount: number): Graph => {
  const graph = new Graph()
  for (let i = 0; i < nodeCount; i++) {
    // 不同的初始坐标，避免 FA2 因坐标重合产生 NaN
    graph.addNode(`n${i}`, { x: Math.cos(i) * (i + 1), y: Math.sin(i) * (i + 1), size: 5 + (i % 5) })
  }
  for (let i = 0; i < nodeCount - 1; i++) {
    graph.addEdge(`n${i}`, `n${i + 1}`)
  }
  return graph
}

describe('resolveAutoLayoutIterations', () => {
  test('floors tiny graphs to the minimum', () => {
    expect(resolveAutoLayoutIterations(1)).toBe(AUTO_LAYOUT_MIN_ITERATIONS)
    expect(resolveAutoLayoutIterations(0)).toBe(AUTO_LAYOUT_MIN_ITERATIONS)
  })

  test('caps large graphs at the maximum', () => {
    expect(resolveAutoLayoutIterations(100000)).toBe(AUTO_LAYOUT_MAX_ITERATIONS)
  })

  test('scales with node count between the bounds', () => {
    const value = resolveAutoLayoutIterations(400)
    expect(value).toBeGreaterThan(AUTO_LAYOUT_MIN_ITERATIONS)
    expect(value).toBeLessThan(AUTO_LAYOUT_MAX_ITERATIONS)
  })
})

describe('resolveForceAtlas2Settings', () => {
  test('enables LinLog clustering and size-aware anti-collision', () => {
    const settings = resolveForceAtlas2Settings(buildGraph(10))
    expect(settings.linLogMode).toBe(true)
    expect(settings.outboundAttractionDistribution).toBe(true)
    expect(settings.adjustSizes).toBe(true)
    // 保留 inferSettings 的规模自适应字段
    expect(settings).toHaveProperty('barnesHutOptimize')
    expect(settings).toHaveProperty('slowDown')
  })
})

describe('applyForceAtlas2Layout', () => {
  test('assigns finite, separated positions', () => {
    const graph = buildGraph(12)
    applyForceAtlas2Layout(graph, { iterations: 50, noverlapIterations: 20 })

    const seen = new Set<string>()
    graph.forEachNode((_node, attr) => {
      expect(Number.isFinite(attr.x as number)).toBe(true)
      expect(Number.isFinite(attr.y as number)).toBe(true)
      seen.add(`${Math.round(attr.x as number)}:${Math.round(attr.y as number)}`)
    })
    // 至少不应坍缩成同一个点
    expect(seen.size).toBeGreaterThan(1)
  })

  test('is a no-op on an empty graph', () => {
    const graph = new Graph()
    expect(() => applyForceAtlas2Layout(graph)).not.toThrow()
  })
})

describe('computeForceAtlas2Layout', () => {
  test('returns target positions without permanently mutating the graph', () => {
    const graph = buildGraph(8)
    const before: Record<string, { x: number; y: number }> = {}
    graph.forEachNode((node, attr) => {
      before[node] = { x: attr.x as number, y: attr.y as number }
    })

    const positions = computeForceAtlas2Layout(graph, { iterations: 40, noverlapIterations: 10 })

    expect(Object.keys(positions)).toHaveLength(graph.order)
    // 图坐标已被还原到计算前
    graph.forEachNode((node, attr) => {
      expect(attr.x).toBeCloseTo(before[node].x, 6)
      expect(attr.y).toBeCloseTo(before[node].y, 6)
    })
  })
})
