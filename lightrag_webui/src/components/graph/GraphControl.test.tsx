import { describe, expect, test, vi } from 'vitest'

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  configurable: true
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('GraphControl — drag gating', () => {
  test('enableNodeDrag defaults to true in settings store', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    expect(useSettingsStore.getState().enableNodeDrag).toBe(true)
  })

  test('enableSearchLinkedDrag defaults to false in settings store', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    expect(useSettingsStore.getState().enableSearchLinkedDrag).toBe(false)
  })

  test('enableNodeDrag can be toggled off', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore.getState().enableNodeDrag = false
    expect(useSettingsStore.getState().enableNodeDrag).toBe(false)
    useSettingsStore.getState().enableNodeDrag = true
  })

  test('search-selected nodes track their selection source', async () => {
    const { useGraphStore } = await import('@/stores/graph')

    useGraphStore.getState().setSelectedNode('node-1', true, 'search')
    expect(useGraphStore.getState().selectedNode).toBe('node-1')
    expect(useGraphStore.getState().selectedNodeSource).toBe('search')

    useGraphStore.getState().clearSelection()
    expect(useGraphStore.getState().selectedNode).toBeNull()
    expect(useGraphStore.getState().selectedNodeSource).toBeNull()
  })

  test('drag coordinate sync updates rawGraph nodes', async () => {
    const { useGraphStore, RawGraph } = await import('@/stores/graph')

    const rawGraph = new RawGraph()
    rawGraph.nodes = [
      {
        id: 'node1',
        labels: ['Node1'],
        properties: { entity_type: 'TEST' },
        size: 10,
        x: 0.1,
        y: 0.2,
        color: '#000',
        degree: 1
      }
    ]
    rawGraph.nodeIdMap = { node1: 0 }
    rawGraph.edges = []
    rawGraph.edgeIdMap = {}
    rawGraph.edgeDynamicIdMap = {}

    useGraphStore.getState().setRawGraph(rawGraph)

    const stored = useGraphStore.getState().rawGraph
    expect(stored).not.toBeNull()
    expect(stored!.nodes[0].x).toBe(0.1)
    expect(stored!.nodes[0].y).toBe(0.2)

    stored!.nodes[0].x = 0.5
    stored!.nodes[0].y = 0.6

    expect(useGraphStore.getState().rawGraph!.nodes[0].x).toBe(0.5)
    expect(useGraphStore.getState().rawGraph!.nodes[0].y).toBe(0.6)
  })

  test('linked drag applies the same delta to direct neighbors', async () => {
    const { applyLinkedDragMovement } = await import('@/utils/graphDrag')

    const positions = {
      center: { x: 10, y: 20 },
      neighborA: { x: 5, y: 7 },
      neighborB: { x: -1, y: 3 },
      other: { x: 100, y: 200 }
    }

    const moved = applyLinkedDragMovement({
      positions,
      draggedNodeId: 'center',
      linkedNodeIds: ['neighborA', 'neighborB'],
      nextPosition: { x: 14, y: 26 }
    })

    expect(moved.center).toEqual({ x: 14, y: 26 })
    expect(moved.neighborA).toEqual({ x: 9, y: 13 })
    expect(moved.neighborB).toEqual({ x: 3, y: 9 })
    expect(moved.other).toEqual({ x: 100, y: 200 })
  })
})

describe('GraphControl — layout settings propagation', () => {
  test('graphLayoutMaxIterations defaults to 15', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    expect(useSettingsStore.getState().graphLayoutMaxIterations).toBe(15)
  })

  test('graphLayoutRepulsion defaults and updates', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    expect(useSettingsStore.getState().graphLayoutRepulsion).toBe(0.02)
    useSettingsStore.getState().setGraphLayoutRepulsion(0.05)
    expect(useSettingsStore.getState().graphLayoutRepulsion).toBe(0.05)
  })

  test('graphLayoutGravity defaults and updates', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    expect(useSettingsStore.getState().graphLayoutGravity).toBe(0.02)
    useSettingsStore.getState().setGraphLayoutGravity(0.03)
    expect(useSettingsStore.getState().graphLayoutGravity).toBe(0.03)
  })

  test('graphLayoutMargin defaults and updates', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    expect(useSettingsStore.getState().graphLayoutMargin).toBe(5)
    useSettingsStore.getState().setGraphLayoutMargin(10)
    expect(useSettingsStore.getState().graphLayoutMargin).toBe(10)
  })
})

describe('GraphControl — edge size recalculation', () => {
  test('minEdgeSize and maxEdgeSize defaults accessible', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    expect(useSettingsStore.getState().minEdgeSize).toBe(1)
    expect(useSettingsStore.getState().maxEdgeSize).toBe(1)
  })

  test('minEdgeSize updates propagate', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore.getState().setMinEdgeSize(3)
    expect(useSettingsStore.getState().minEdgeSize).toBe(3)
    useSettingsStore.getState().setMinEdgeSize(1)
  })

  test('maxEdgeSize updates propagate', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore.getState().setMaxEdgeSize(5)
    expect(useSettingsStore.getState().maxEdgeSize).toBe(5)
    useSettingsStore.getState().setMaxEdgeSize(1)
  })
})
