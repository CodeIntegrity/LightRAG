import { describe, expect, test } from 'vitest'

import {
  buildExpandedGraph,
  type GraphExpandWorkerInput
} from '@/utils/graphLayout'
import { createGraphRequestState } from '@/utils/graphRequestState'
import { applyPersistedLayoutParams } from '@/utils/graphViewPersistence'

describe('useLightragGraph request lifecycle', () => {
  test('只允许最后一次查询结果写入 store', () => {
    const requestState = createGraphRequestState()
    const first = requestState.start()
    const second = requestState.start()

    expect(first.signal.aborted).toBe(true)
    expect(requestState.isCurrent(first.requestId)).toBe(false)
    expect(requestState.isCurrent(second.requestId)).toBe(true)
  })
})

describe('graph expand worker path', () => {
  test('节点展开使用异步 worker 结果', async () => {
    const { runGraphLayoutTask } = await import('./useGraphLayoutWorker')
    const input: GraphExpandWorkerInput = {
      expandedNodeId: 'root',
      expandedNodeSize: 12,
      cameraRatio: 1,
      existingNodes: [{ id: 'root', x: 0, y: 0, degree: 1 }],
      existingEdges: [],
      incomingNodes: [
        {
          id: 'root',
          labels: ['root'],
          properties: { entity_id: 'root' },
          size: 12,
          x: 0,
          y: 0,
          color: '#000',
          degree: 1
        },
        {
          id: 'child',
          labels: ['child'],
          properties: { entity_id: 'child' },
          size: 10,
          x: 0,
          y: 0,
          color: '#111',
          degree: 0
        }
      ],
      incomingEdges: [
        {
          id: 'root-child',
          source: 'root',
          target: 'child',
          properties: { weight: 1 },
          dynamicId: ''
        }
      ]
    }

    let settled = false
    const promise = runGraphLayoutTask(input, null).then((result) => {
      settled = true
      return result
    })

    expect(settled).toBe(false)
    const result = await promise
    const directResult = buildExpandedGraph(input)

    expect(result.nodesToAdd).toHaveLength(1)
    expect(result.nodesToAdd[0].id).toBe('child')
    expect(result).toEqual(directResult)
  })
})

describe('graph store — rawGraph coordinate persistence', () => {
  test('rawGraph nodes store x/y coordinates from backend data', async () => {
    const { useGraphStore, RawGraph } = await import('@/stores/graph')

    const rawGraph = new RawGraph()
    rawGraph.nodes = [
      {
        id: 'node1',
        labels: ['Node1'],
        properties: { entity_type: 'TEST' },
        size: 12,
        x: 0.75,
        y: 0.25,
        color: '#ff0000',
        degree: 3
      },
      {
        id: 'node2',
        labels: ['Node2'],
        properties: { entity_type: 'TEST' },
        size: 8,
        x: 0.3,
        y: 0.6,
        color: '#00ff00',
        degree: 1
      }
    ]
    rawGraph.nodeIdMap = { node1: 0, node2: 1 }
    rawGraph.edges = []
    rawGraph.edgeIdMap = {}
    rawGraph.edgeDynamicIdMap = {}

    useGraphStore.getState().setRawGraph(rawGraph)

    const stored = useGraphStore.getState().rawGraph!
    expect(stored.nodes[0].x).toBe(0.75)
    expect(stored.nodes[0].y).toBe(0.25)
    expect(stored.nodes[1].x).toBe(0.3)
    expect(stored.nodes[1].y).toBe(0.6)
  })

  test('rawGraph coordinate updates are immediately readable', async () => {
    const { useGraphStore, RawGraph } = await import('@/stores/graph')

    const rawGraph = new RawGraph()
    rawGraph.nodes = [{ id: 'n1', labels: ['N1'], properties: {}, size: 10, x: 0, y: 0, color: '#000', degree: 0 }]
    rawGraph.nodeIdMap = { n1: 0 }
    rawGraph.edges = []
    rawGraph.edgeIdMap = {}
    rawGraph.edgeDynamicIdMap = {}

    useGraphStore.getState().setRawGraph(rawGraph)

    const rg = useGraphStore.getState().rawGraph!
    const idx = rg.nodeIdMap['n1']
    expect(idx).toBe(0)
    rg.nodes[idx!].x = 0.9
    rg.nodes[idx!].y = 0.1

    expect(useGraphStore.getState().rawGraph!.nodes[0].x).toBe(0.9)
    expect(useGraphStore.getState().rawGraph!.nodes[0].y).toBe(0.1)
  })
})

describe('settings store — layout params defaults', () => {
  test('all layout params have expected defaults', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const state = useSettingsStore.getState()
    expect(state.graphLayoutMaxIterations).toBe(15)
    expect(state.graphLayoutRepulsion).toBe(0.02)
    expect(state.graphLayoutGravity).toBe(0.02)
    expect(state.graphLayoutMargin).toBe(5)
    expect(state.graphLayoutAttraction).toBe(0.0003)
    expect(state.graphLayoutInertia).toBe(0.4)
    expect(state.graphLayoutMaxMove).toBe(100)
    expect(state.graphLayoutExpansion).toBe(1.1)
    expect(state.graphLayoutGridSize).toBe(1)
    expect(state.graphLayoutRatio).toBe(1)
    expect(state.graphLayoutSpeed).toBe(3)
  })

  test('setGraphLayoutRepulsion rejects values below 0.001', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore.getState().setGraphLayoutRepulsion(0.0005)
    expect(useSettingsStore.getState().graphLayoutRepulsion).toBe(0.0005)
  })

  test('setGraphLayoutGravity updates atomically', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const initial = useSettingsStore.getState().graphLayoutGravity
    useSettingsStore.getState().setGraphLayoutGravity(0.08)
    const updated = useSettingsStore.getState().graphLayoutGravity
    expect(updated).toBe(0.08)
    expect(updated).not.toBe(initial)
    useSettingsStore.getState().setGraphLayoutGravity(0.02)
  })

  test('applyPersistedLayoutParams restores full persisted layout settings', () => {
    const calls: string[] = []
    const settings = {
      setGraphLayoutRepulsion: (value: number) => calls.push(`repulsion:${value}`),
      setGraphLayoutGravity: (value: number) => calls.push(`gravity:${value}`),
      setGraphLayoutMargin: (value: number) => calls.push(`margin:${value}`),
      setGraphLayoutMaxIterations: (value: number) => calls.push(`iterations:${value}`),
      setGraphLayoutAttraction: (value: number) => calls.push(`attraction:${value}`),
      setGraphLayoutInertia: (value: number) => calls.push(`inertia:${value}`),
      setGraphLayoutMaxMove: (value: number) => calls.push(`maxMove:${value}`),
      setGraphLayoutExpansion: (value: number) => calls.push(`expansion:${value}`),
      setGraphLayoutGridSize: (value: number) => calls.push(`gridSize:${value}`),
      setGraphLayoutRatio: (value: number) => calls.push(`ratio:${value}`),
      setGraphLayoutSpeed: (value: number) => calls.push(`speed:${value}`)
    }

    applyPersistedLayoutParams(
      {
        repulsion: 0.08,
        gravity: 0.04,
        margin: 8,
        maxIterations: 25,
        attraction: 0.0006,
        inertia: 0.55,
        maxMove: 70,
        expansion: 1.4,
        gridSize: 3,
        ratio: 1.3,
        speed: 5
      },
      settings
    )

    expect(calls).toEqual([
      'repulsion:0.08',
      'gravity:0.04',
      'margin:8',
      'iterations:25',
      'attraction:0.0006',
      'inertia:0.55',
      'maxMove:70',
      'expansion:1.4',
      'gridSize:3',
      'ratio:1.3',
      'speed:5'
    ])
  })
})
