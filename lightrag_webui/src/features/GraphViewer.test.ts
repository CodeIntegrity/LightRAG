import { describe, expect, test } from 'vitest'

Object.defineProperty(globalThis, 'WebGL2RenderingContext', {
  value: {
    BOOL: 0,
    BYTE: 1,
    UNSIGNED_BYTE: 2,
    SHORT: 3,
    UNSIGNED_SHORT: 4,
    INT: 5,
    UNSIGNED_INT: 6,
    FLOAT: 7
  },
  configurable: true
})

Object.defineProperty(globalThis, 'WebGLRenderingContext', {
  value: {
    BOOL: 0,
    BYTE: 1,
    UNSIGNED_BYTE: 2,
    SHORT: 3,
    UNSIGNED_SHORT: 4,
    INT: 5,
    UNSIGNED_INT: 6,
    FLOAT: 7
  },
  configurable: true
})

describe('GraphViewer sigma settings', () => {
  test('uses curved arrow edges when directional arrows are enabled', async () => {
    const { createSigmaSettings } = await import('@/utils/graphSigmaSettings')

    const settings = createSigmaSettings(false, 12, false, true)

    expect(settings.defaultEdgeType).toBe('curvedArrow')
  })

  test('uses curved edges without arrows when directional arrows are disabled', async () => {
    const { createSigmaSettings } = await import('@/utils/graphSigmaSettings')

    const settings = createSigmaSettings(false, 12, false, false)

    expect(settings.defaultEdgeType).toBe('curvedNoArrow')
  })
})

describe('graph edge type helper', () => {
  test('maps enabled directional arrows to curvedArrow', async () => {
    const { getGraphEdgeType } = await import('@/utils/graphEdgeType')
    expect(getGraphEdgeType(true)).toBe('curvedArrow')
  })

  test('maps disabled directional arrows to curvedNoArrow', async () => {
    const { getGraphEdgeType } = await import('@/utils/graphEdgeType')
    expect(getGraphEdgeType(false)).toBe('curvedNoArrow')
  })
})
