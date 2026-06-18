import { describe, expect, test } from 'bun:test'
import Graph from 'graphology'

import {
  AUTO_LAYOUT_MAX_ITERATIONS,
  AUTO_LAYOUT_MIN_ITERATIONS,
  applyForceAtlas2Layout,
  computeForceAtlas2Layout,
  computeClusteredCirclepack,
  resolveAutoLayoutIterations,
  resolveClusterAttribute,
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

  test('退化（全部重合）坐标输入不产生 NaN —— 防止切换布局时节点消失', () => {
    const graph = new Graph()
    for (let i = 0; i < 12; i++) {
      graph.addNode(`n${i}`, { x: 0, y: 0, size: 6 }) // 全部重合：FA2/noverlap 会除零
    }
    for (let i = 0; i < 11; i++) {
      graph.addEdge(`n${i}`, `n${i + 1}`)
    }
    applyForceAtlas2Layout(graph, { iterations: 60, noverlapIterations: 20 })
    graph.forEachNode((_node, attr) => {
      expect(Number.isFinite(attr.x as number)).toBe(true)
      expect(Number.isFinite(attr.y as number)).toBe(true)
    })
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

describe('聚集布局', () => {
  const buildClusteredGraph = () => {
    const graph = new Graph()
    // 两组（社区 0/1，同时带实体类型），组内密集、组间仅一条边
    for (let i = 0; i < 6; i++) {
      graph.addNode(`a${i}`, {
        x: Math.cos(i),
        y: Math.sin(i),
        size: 5,
        community: 0,
        entityType: 'person'
      })
    }
    for (let i = 0; i < 6; i++) {
      graph.addNode(`b${i}`, {
        x: Math.cos(i) + 10,
        y: Math.sin(i) + 10,
        size: 5,
        community: 1,
        entityType: 'organization'
      })
    }
    for (let i = 0; i < 5; i++) {
      graph.addEdge(`a${i}`, `a${i + 1}`)
      graph.addEdge(`b${i}`, `b${i + 1}`)
    }
    graph.addEdge('a0', 'b0')
    return graph
  }

  test('resolveClusterAttribute 映射正确', () => {
    expect(resolveClusterAttribute('none')).toBeUndefined()
    expect(resolveClusterAttribute('type')).toBe('entityType')
    expect(resolveClusterAttribute('community')).toBe('community')
  })

  test('clusterAttribute 的 FA2 输出有限坐标（按社区 / 按类型）', () => {
    for (const attribute of ['community', 'entityType']) {
      const graph = buildClusteredGraph()
      applyForceAtlas2Layout(graph, { clusterAttribute: attribute, iterations: 50, noverlapIterations: 20 })
      graph.forEachNode((_node, attr) => {
        expect(Number.isFinite(attr.x as number)).toBe(true)
        expect(Number.isFinite(attr.y as number)).toBe(true)
      })
    }
  })

  test('computeClusteredCirclepack 返回位置且不永久改动图', () => {
    const graph = buildClusteredGraph()
    const before: Record<string, { x: number; y: number }> = {}
    graph.forEachNode((node, attr) => {
      before[node] = { x: attr.x as number, y: attr.y as number }
    })

    const positions = computeClusteredCirclepack(graph, 'community')

    expect(Object.keys(positions)).toHaveLength(graph.order)
    for (const id in positions) {
      expect(Number.isFinite(positions[id].x)).toBe(true)
      expect(Number.isFinite(positions[id].y)).toBe(true)
    }
    graph.forEachNode((node, attr) => {
      expect(attr.x).toBeCloseTo(before[node].x, 6)
      expect(attr.y).toBeCloseTo(before[node].y, 6)
    })
  })
})
