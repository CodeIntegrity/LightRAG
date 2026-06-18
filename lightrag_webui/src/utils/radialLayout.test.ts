import { describe, expect, test } from 'bun:test'
import Graph from 'graphology'

import { computeRadialLayout } from './radialLayout'

describe('computeRadialLayout', () => {
  test('places center at origin and rings by BFS depth', () => {
    // center - a - b   (center度数最高，应作为中心)
    const graph = new Graph()
    graph.addNode('center')
    graph.addNode('a')
    graph.addNode('b')
    graph.addNode('c')
    graph.addEdge('center', 'a')
    graph.addEdge('center', 'b')
    graph.addEdge('a', 'c') // c 距中心 2 跳

    const pos = computeRadialLayout(graph, { center: 'center', ringGap: 10 })

    // 中心在原点
    expect(pos.center).toEqual({ x: 0, y: 0 })

    // 第 1 层（a, b）半径 10，第 2 层（c）半径 20
    const r = (id: string) => Math.hypot(pos[id].x, pos[id].y)
    expect(r('a')).toBeCloseTo(10)
    expect(r('b')).toBeCloseTo(10)
    expect(r('c')).toBeCloseTo(20)
  })

  test('disconnected nodes go to an outer ring beyond the max depth', () => {
    const graph = new Graph()
    graph.addNode('center')
    graph.addNode('a')
    graph.addNode('island') // 不连通
    graph.addEdge('center', 'a')

    const pos = computeRadialLayout(graph, { center: 'center', ringGap: 10 })
    const r = (id: string) => Math.hypot(pos[id].x, pos[id].y)

    // maxDepth=1 → 孤立点落在 ring 2，半径 20
    expect(r('island')).toBeCloseTo(20)
  })

  test('returns empty for empty graph', () => {
    expect(computeRadialLayout(new Graph())).toEqual({})
  })
})
