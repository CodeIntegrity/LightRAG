import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  buildGraphViewKey,
  saveGraphView,
  loadGraphView,
  clearGraphView,
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
})

describe('saveGraphView / loadGraphView', () => {
  test('saves and loads full view data', () => {
    const viewKey = buildGraphViewKey('ws1', 'label1')
    const data: Partial<PersistedGraphView> = {
      nodePositions: { 'node1': { x: 10, y: 20 } },
      layoutType: 'Force Directed',
      layoutParams: { repulsion: 0.05, gravity: 0.03, margin: 10, maxIterations: 20 }
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
  })

  test('merge preserves existing data', () => {
    const viewKey = buildGraphViewKey('ws1', 'label1')

    saveGraphView(viewKey, {
      nodePositions: { 'node1': { x: 10, y: 20 } },
      layoutType: 'Circular',
      layoutParams: { repulsion: 0.05, gravity: 0.03, margin: 10, maxIterations: 20 }
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
