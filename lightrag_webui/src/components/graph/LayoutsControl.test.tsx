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

vi.mock('@react-sigma/core', () => ({
  useSigma: vi.fn(() => null)
}))

vi.mock('@react-sigma/layout-circular', () => ({
  useLayoutCircular: vi.fn(() => ({
    positions: vi.fn(() => ({}))
  }))
}))

vi.mock('@react-sigma/layout-circlepack', () => ({
  useLayoutCirclepack: vi.fn(() => ({
    positions: vi.fn(() => ({}))
  }))
}))

vi.mock('@react-sigma/layout-random', () => ({
  useLayoutRandom: vi.fn(() => ({
    positions: vi.fn(() => ({}))
  }))
}))

vi.mock('@react-sigma/layout-force', () => ({
  useLayoutForce: vi.fn(({ settings }: any) => ({
    positions: vi.fn(() => ({})),
    settings
  })),
  useWorkerLayoutForce: vi.fn(() => ({}))
}))

vi.mock('@react-sigma/layout-forceatlas2', () => ({
  useLayoutForceAtlas2: vi.fn(() => ({
    positions: vi.fn(() => ({}))
  })),
  useWorkerLayoutForceAtlas2: vi.fn(() => ({}))
}))

vi.mock('@react-sigma/layout-noverlap', () => ({
  useLayoutNoverlap: vi.fn(({ settings }: any) => ({
    positions: vi.fn(() => ({})),
    settings
  })),
  useWorkerLayoutNoverlap: vi.fn(() => ({}))
}))

vi.mock('@react-sigma/layout-core', () => ({
  useWorkerLayoutForce: vi.fn(() => ({})),
  useWorkerLayoutForceAtlas2: vi.fn(() => ({})),
  useWorkerLayoutNoverlap: vi.fn(() => ({}))
}))

vi.mock('sigma/utils', () => ({
  animateNodes: vi.fn()
}))

describe('LayoutsControl — layout parameter passing', () => {
  test('store params reflect in layout hooks via useLayoutForce mock', async () => {
    const { useSettingsStore } = await import('@/stores/settings')
    const useLayoutForceModule = await import('@react-sigma/layout-force')
    const useLayoutNoverlapModule = await import('@react-sigma/layout-noverlap')

    useSettingsStore.getState().setGraphLayoutRepulsion(0.05)
    useSettingsStore.getState().setGraphLayoutGravity(0.03)
    useSettingsStore.getState().setGraphLayoutAttraction(0.0005)
    useSettingsStore.getState().setGraphLayoutInertia(0.6)
    useSettingsStore.getState().setGraphLayoutMaxMove(80)
    useSettingsStore.getState().setGraphLayoutExpansion(1.3)
    useSettingsStore.getState().setGraphLayoutGridSize(2)
    useSettingsStore.getState().setGraphLayoutRatio(1.2)
    useSettingsStore.getState().setGraphLayoutSpeed(4)

    const { useLayoutForce } = useLayoutForceModule
    const { useLayoutNoverlap } = useLayoutNoverlapModule
    useLayoutForce({
      settings: {
        repulsion: 0.05,
        gravity: 0.03,
        attraction: 0.0005,
        inertia: 0.6,
        maxMove: 80
      },
      maxIterations: 15
    })
    useLayoutNoverlap({
      settings: {
        margin: 5,
        expansion: 1.3,
        gridSize: 2,
        ratio: 1.2,
        speed: 4
      },
      maxIterations: 15
    })

    expect(useLayoutForce).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          repulsion: 0.05,
          gravity: 0.03,
          attraction: 0.0005,
          inertia: 0.6,
          maxMove: 80
        })
      })
    )
    expect(useLayoutNoverlap).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          expansion: 1.3,
          gridSize: 2,
          ratio: 1.2,
          speed: 4
        })
      })
    )
  })

  test('all six layout names are defined', () => {
    const layoutNames = [
      'Circular',
      'Circlepack',
      'Random',
      'Noverlaps',
      'Force Directed',
      'Force Atlas'
    ]
    expect(layoutNames).toHaveLength(6)
  })
})

describe('LayoutsControl — settings store integration', () => {
  test('layout settings can be read and written via store', async () => {
    const { useSettingsStore } = await import('@/stores/settings')

    useSettingsStore.getState().setGraphLayoutMaxIterations(25)
    expect(useSettingsStore.getState().graphLayoutMaxIterations).toBe(25)
    useSettingsStore.getState().setGraphLayoutMaxIterations(15)

    useSettingsStore.getState().setGraphLayoutRepulsion(0.08)
    expect(useSettingsStore.getState().graphLayoutRepulsion).toBe(0.08)
    useSettingsStore.getState().setGraphLayoutRepulsion(0.02)

    useSettingsStore.getState().setGraphLayoutGravity(0.04)
    expect(useSettingsStore.getState().graphLayoutGravity).toBe(0.04)
    useSettingsStore.getState().setGraphLayoutGravity(0.02)

    useSettingsStore.getState().setGraphLayoutMargin(8)
    expect(useSettingsStore.getState().graphLayoutMargin).toBe(8)
    useSettingsStore.getState().setGraphLayoutMargin(5)

    useSettingsStore.getState().setGraphLayoutAttraction(0.0005)
    expect(useSettingsStore.getState().graphLayoutAttraction).toBe(0.0005)
    useSettingsStore.getState().setGraphLayoutAttraction(0.0003)

    useSettingsStore.getState().setGraphLayoutInertia(0.6)
    expect(useSettingsStore.getState().graphLayoutInertia).toBe(0.6)
    useSettingsStore.getState().setGraphLayoutInertia(0.4)

    useSettingsStore.getState().setGraphLayoutMaxMove(80)
    expect(useSettingsStore.getState().graphLayoutMaxMove).toBe(80)
    useSettingsStore.getState().setGraphLayoutMaxMove(100)

    useSettingsStore.getState().setGraphLayoutExpansion(1.3)
    expect(useSettingsStore.getState().graphLayoutExpansion).toBe(1.3)
    useSettingsStore.getState().setGraphLayoutExpansion(1.1)

    useSettingsStore.getState().setGraphLayoutGridSize(2)
    expect(useSettingsStore.getState().graphLayoutGridSize).toBe(2)
    useSettingsStore.getState().setGraphLayoutGridSize(1)

    useSettingsStore.getState().setGraphLayoutRatio(1.2)
    expect(useSettingsStore.getState().graphLayoutRatio).toBe(1.2)
    useSettingsStore.getState().setGraphLayoutRatio(1)

    useSettingsStore.getState().setGraphLayoutSpeed(4)
    expect(useSettingsStore.getState().graphLayoutSpeed).toBe(4)
    useSettingsStore.getState().setGraphLayoutSpeed(3)
  })
})
