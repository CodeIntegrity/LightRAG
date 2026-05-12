import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  applyPersistedNodePositions,
  DEFAULT_GRAPH_LAYOUT,
  buildGraphViewKey,
  loadGraphCameraView,
  loadGraphLayoutParams,
  loadGraphLayoutType,
  loadGraphNodePositions,
  loadGraphViewForContext,
  restorePersistedCameraView,
  resolveGraphViewKey,
  saveGraphCameraView,
  saveGraphLayoutView,
  saveGraphLayoutSettings,
  saveGraphNodePosition,
  saveGraphViewForContext,
  saveGraphView,
  loadGraphView,
  clearGraphView,
  isSupportedGraphLayout,
  subscribeToCameraViewPersistence,
  type PersistedGraphView
} from '@/utils/graphViewPersistence'

const storage = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
    get length() { return storage.size },
    key: vi.fn((index: number) => {
      const keys = Array.from(storage.keys())
      return keys[index] || null
    }),
    clear: vi.fn(() => storage.clear())
  },
  configurable: true
})

beforeEach(() => {
  storage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('buildGraphViewKey', () => {
  test('builds key from workspace and query label', () => {
    expect(buildGraphViewKey('ws1', 'label1')).toBe('ws1::label1')
  })

  test('uses default for empty workspace', () => {
    expect(buildGraphViewKey('', 'mylabel')).toBe('default::mylabel')
  })

  test('uses * for empty query label', () => {
    expect(buildGraphViewKey('ws1', '')).toBe('ws1::*')
  })

  test('resolves key from context object', () => {
    expect(
      resolveGraphViewKey({
        workspace: '',
        queryLabel: ''
      })
    ).toBe('default::*')
  })
})

describe('layout type helpers', () => {
  test('accepts supported layout type', () => {
    expect(isSupportedGraphLayout('Force Directed')).toBe(true)
  })

  test('falls back for unsupported layout type', () => {
    expect(isSupportedGraphLayout('Hierarchy')).toBe(false)
  })

  test('restores persisted camera view over existing camera state', () => {
    const camera = {
      getState: () => ({ x: 0, y: 0, ratio: 1, angle: 0.75 }),
      setState: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    }

    restorePersistedCameraView(camera, {
      x: 10,
      y: 20,
      ratio: 1.4
    })

    expect(camera.setState).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      ratio: 1.4,
      angle: 0.75
    })
  })

  test('applies persisted node positions onto matching nodes only', () => {
    const nodes = [
      { id: 'node-1', x: 0, y: 0 },
      { id: 'node-2', x: 5, y: 6 }
    ]

    applyPersistedNodePositions(
      nodes,
      {
        'node-1': { x: 1.2, y: 3.4 },
        missing: { x: 9, y: 9 }
      }
    )

    expect(nodes).toEqual([
      { id: 'node-1', x: 1.2, y: 3.4 },
      { id: 'node-2', x: 5, y: 6 }
    ])
  })

  test('subscribes camera updates and persists debounced camera view', () => {
    vi.useFakeTimers()

    let listener: (() => void) | undefined
    const camera = {
      getState: vi.fn(() => ({ x: 5, y: 6, ratio: 1.25, angle: 0.1 })),
      setState: vi.fn(),
      on: vi.fn((_event: 'updated', nextListener: () => void) => {
        listener = nextListener
      }),
      off: vi.fn()
    }

    const cleanup = subscribeToCameraViewPersistence(
      camera,
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      50
    )

    expect(camera.on).toHaveBeenCalledTimes(1)
    listener?.()
    vi.advanceTimersByTime(49)
    expect(loadGraphViewForContext({ workspace: 'ws1', queryLabel: 'label1' })).toBeNull()

    vi.advanceTimersByTime(1)
    expect(loadGraphViewForContext({ workspace: 'ws1', queryLabel: 'label1' })?.cameraView).toEqual({
      x: 5,
      y: 6,
      ratio: 1.25
    })

    cleanup()
    expect(camera.off).toHaveBeenCalledTimes(1)
  })
})

describe('saveGraphView / loadGraphView', () => {
  test('loads graph view from workspace/query context', () => {
    const data: Partial<PersistedGraphView> = {
      nodePositions: { node1: { x: 10, y: 20 } }
    }

    saveGraphViewForContext(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      data
    )

    expect(
      loadGraphViewForContext({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toMatchObject(data)
  })

  test('loads persisted layout type with fallback', () => {
    expect(
      loadGraphLayoutType({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toBe(DEFAULT_GRAPH_LAYOUT)

    saveGraphViewForContext(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      {
        layoutType: 'Force Directed'
      }
    )

    expect(
      loadGraphLayoutType({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toBe('Force Directed')
  })

  test('loads persisted layout params only when present', () => {
    expect(
      loadGraphLayoutParams({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toBeNull()

    saveGraphLayoutSettings(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      {
        graphLayoutRepulsion: 0.08,
        graphLayoutGravity: 0.03,
        graphLayoutMargin: 9,
        graphLayoutMaxIterations: 24,
        graphLayoutAttraction: 0.0007,
        graphLayoutInertia: 0.6,
        graphLayoutMaxMove: 85,
        graphLayoutExpansion: 1.5,
        graphLayoutGridSize: 4,
        graphLayoutRatio: 1.2,
        graphLayoutSpeed: 6
      }
    )

    expect(
      loadGraphLayoutParams({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toEqual({
      repulsion: 0.08,
      gravity: 0.03,
      margin: 9,
      maxIterations: 24,
      attraction: 0.0007,
      inertia: 0.6,
      maxMove: 85,
      expansion: 1.5,
      gridSize: 4,
      ratio: 1.2,
      speed: 6
    })
  })

  test('loads persisted camera view only when present', () => {
    expect(
      loadGraphCameraView({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toBeNull()

    saveGraphCameraView(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      {
        x: 10,
        y: 20,
        ratio: 1.4
      }
    )

    expect(
      loadGraphCameraView({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toEqual({
      x: 10,
      y: 20,
      ratio: 1.4
    })
  })

  test('loads persisted node positions as an empty map when absent', () => {
    expect(
      loadGraphNodePositions({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toEqual({})

    saveGraphNodePosition(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      'node-1',
      4.5,
      8.25
    )

    expect(
      loadGraphNodePositions({
        workspace: 'ws1',
        queryLabel: 'label1'
      })
    ).toEqual({
      'node-1': { x: 4.5, y: 8.25 }
    })
  })

  test('saves layout view from settings snapshot', () => {
    saveGraphLayoutView(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      'Force Directed',
      {
        graphLayoutRepulsion: 0.08,
        graphLayoutGravity: 0.03,
        graphLayoutMargin: 9,
        graphLayoutMaxIterations: 24,
        graphLayoutAttraction: 0.0007,
        graphLayoutInertia: 0.6,
        graphLayoutMaxMove: 85,
        graphLayoutExpansion: 1.5,
        graphLayoutGridSize: 4,
        graphLayoutRatio: 1.2,
        graphLayoutSpeed: 6
      }
    )

    expect(loadGraphViewForContext({ workspace: 'ws1', queryLabel: 'label1' })).toMatchObject({
      layoutType: 'Force Directed',
      layoutParams: {
        repulsion: 0.08,
        gravity: 0.03,
        margin: 9,
        maxIterations: 24,
        attraction: 0.0007,
        inertia: 0.6,
        maxMove: 85,
        expansion: 1.5,
        gridSize: 4,
        ratio: 1.2,
        speed: 6
      }
    })
  })

  test('saves layout settings without overwriting layout type', () => {
    saveGraphViewForContext(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      {
        layoutType: 'Circlepack'
      }
    )

    saveGraphLayoutSettings(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      {
        graphLayoutRepulsion: 0.08,
        graphLayoutGravity: 0.03,
        graphLayoutMargin: 9,
        graphLayoutMaxIterations: 24,
        graphLayoutAttraction: 0.0007,
        graphLayoutInertia: 0.6,
        graphLayoutMaxMove: 85,
        graphLayoutExpansion: 1.5,
        graphLayoutGridSize: 4,
        graphLayoutRatio: 1.2,
        graphLayoutSpeed: 6
      }
    )

    expect(loadGraphViewForContext({ workspace: 'ws1', queryLabel: 'label1' })).toMatchObject({
      layoutType: 'Circlepack',
      layoutParams: {
        repulsion: 0.08,
        gravity: 0.03,
        margin: 9,
        maxIterations: 24,
        attraction: 0.0007,
        inertia: 0.6,
        maxMove: 85,
        expansion: 1.5,
        gridSize: 4,
        ratio: 1.2,
        speed: 6
      }
    })
  })

  test('saves camera view from camera state snapshot', () => {
    saveGraphCameraView(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      {
        x: 10,
        y: 20,
        ratio: 1.4,
        angle: 0.5
      }
    )

    expect(loadGraphViewForContext({ workspace: 'ws1', queryLabel: 'label1' })?.cameraView).toEqual({
      x: 10,
      y: 20,
      ratio: 1.4
    })
  })

  test('saves a single graph node position', () => {
    saveGraphNodePosition(
      {
        workspace: 'ws1',
        queryLabel: 'label1'
      },
      'node-1',
      4.5,
      8.25
    )

    expect(loadGraphViewForContext({ workspace: 'ws1', queryLabel: 'label1' })?.nodePositions).toEqual({
      'node-1': { x: 4.5, y: 8.25 }
    })
  })

  test('saves and loads full view data', () => {
    const viewKey = buildGraphViewKey('ws1', 'label1')
    const data: Partial<PersistedGraphView> = {
      nodePositions: { 'node1': { x: 10, y: 20 } },
      layoutType: 'Force Directed',
      layoutParams: {
        repulsion: 0.05,
        gravity: 0.03,
        margin: 10,
        maxIterations: 20,
        attraction: 0.0005,
        inertia: 0.6,
        maxMove: 80,
        expansion: 1.3,
        gridSize: 2,
        ratio: 1.2,
        speed: 4
      }
    }

    saveGraphView(viewKey, data)
    const loaded = loadGraphView(viewKey)

    expect(loaded).not.toBeNull()
    expect(loaded!.nodePositions['node1']).toEqual({ x: 10, y: 20 })
    expect(loaded!.layoutType).toBe('Force Directed')
    expect(loaded!.layoutParams.repulsion).toBe(0.05)
    expect(loaded!.layoutParams.gravity).toBe(0.03)
    expect(loaded!.layoutParams.margin).toBe(10)
    expect(loaded!.layoutParams.maxIterations).toBe(20)
    expect(loaded!.layoutParams.attraction).toBe(0.0005)
    expect(loaded!.layoutParams.inertia).toBe(0.6)
    expect(loaded!.layoutParams.maxMove).toBe(80)
    expect(loaded!.layoutParams.expansion).toBe(1.3)
    expect(loaded!.layoutParams.gridSize).toBe(2)
    expect(loaded!.layoutParams.ratio).toBe(1.2)
    expect(loaded!.layoutParams.speed).toBe(4)
  })

  test('merge preserves existing data', () => {
    const viewKey = buildGraphViewKey('ws1', 'label1')

    saveGraphView(viewKey, {
      nodePositions: { 'node1': { x: 10, y: 20 } },
      layoutType: 'Circular',
      layoutParams: {
        repulsion: 0.05,
        gravity: 0.03,
        margin: 10,
        maxIterations: 20,
        attraction: 0.0005,
        inertia: 0.6,
        maxMove: 80,
        expansion: 1.3,
        gridSize: 2,
        ratio: 1.2,
        speed: 4
      }
    })

    saveGraphView(viewKey, {
      nodePositions: { 'node2': { x: 30, y: 40 } },
      cameraView: { x: 100, y: 200, ratio: 1.5 }
    })

    const loaded = loadGraphView(viewKey)
    expect(loaded!.nodePositions['node1']).toEqual({ x: 10, y: 20 })
    expect(loaded!.nodePositions['node2']).toEqual({ x: 30, y: 40 })
    expect(loaded!.layoutType).toBe('Circular')
    expect(loaded!.cameraView).toEqual({ x: 100, y: 200, ratio: 1.5 })
    expect(loaded!.layoutParams.speed).toBe(4)
  })

  test('returns null for non-existent key', () => {
    const loaded = loadGraphView('nonexistent::key')
    expect(loaded).toBeNull()
  })

  test('returns null for corrupted data', () => {
    const viewKey = buildGraphViewKey('ws1', 'label1')
    storage.set(`lightrag-graph-view:${viewKey}`, 'not-json')
    const loaded = loadGraphView(viewKey)
    expect(loaded).toBeNull()
  })

  test('returns null for missing required fields', () => {
    const viewKey = buildGraphViewKey('ws1', 'label1')
    storage.set(`lightrag-graph-view:${viewKey}`, JSON.stringify({}))
    const loaded = loadGraphView(viewKey)
    expect(loaded).toBeNull()
  })

  test('fills defaults for legacy layout params when loading old persisted data', () => {
    const viewKey = buildGraphViewKey('ws1', 'legacy')
    storage.set(
      `lightrag-graph-view:${viewKey}`,
      JSON.stringify({
        nodePositions: { node1: { x: 1, y: 2 } },
        layoutType: 'Force Directed',
        layoutParams: { repulsion: 0.07, gravity: 0.04, margin: 9, maxIterations: 22 },
        savedAt: Date.now()
      })
    )

    const loaded = loadGraphView(viewKey)

    expect(loaded).not.toBeNull()
    expect(loaded!.layoutParams.repulsion).toBe(0.07)
    expect(loaded!.layoutParams.gravity).toBe(0.04)
    expect(loaded!.layoutParams.margin).toBe(9)
    expect(loaded!.layoutParams.maxIterations).toBe(22)
    expect(loaded!.layoutParams.attraction).toBe(0.0003)
    expect(loaded!.layoutParams.inertia).toBe(0.4)
    expect(loaded!.layoutParams.maxMove).toBe(100)
    expect(loaded!.layoutParams.expansion).toBe(1.1)
    expect(loaded!.layoutParams.gridSize).toBe(1)
    expect(loaded!.layoutParams.ratio).toBe(1)
    expect(loaded!.layoutParams.speed).toBe(3)
  })
})

describe('clearGraphView', () => {
  test('removes persisted entry', () => {
    const viewKey = buildGraphViewKey('ws1', 'label1')
    saveGraphView(viewKey, { nodePositions: { 'n1': { x: 0, y: 0 } } })

    clearGraphView(viewKey)
    expect(loadGraphView(viewKey)).toBeNull()
  })
})

describe('pruning', () => {
  test('prunes oldest entries when exceeding max', () => {
    const entries = 55

    for (let i = 0; i < entries; i++) {
      const viewKey = buildGraphViewKey('ws', `label${i}`)
      saveGraphView(viewKey, { nodePositions: { [`n${i}`]: { x: i, y: i } } })
    }

    const graphViewKeys = Array.from(storage.keys()).filter(k => k.startsWith('lightrag-graph-view:'))
    expect(graphViewKeys.length).toBeLessThanOrEqual(50)

    const oldest = loadGraphView(buildGraphViewKey('ws', 'label0'))
    expect(oldest).toBeNull()
  })

  test('does not prune when under max', () => {
    for (let i = 0; i < 5; i++) {
      const viewKey = buildGraphViewKey('ws', `label${i}`)
      saveGraphView(viewKey, { nodePositions: { [`n${i}`]: { x: i, y: i } } })
    }

    const graphViewKeys = Array.from(storage.keys()).filter(k => k.startsWith('lightrag-graph-view:'))
    expect(graphViewKeys.length).toBe(5)
  })
})
