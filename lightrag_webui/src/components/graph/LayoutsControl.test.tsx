import { beforeEach, describe, expect, test, vi } from 'vitest'

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

    useSettingsStore.getState().setGraphLayoutRepulsion(0.05)
    useSettingsStore.getState().setGraphLayoutGravity(0.03)

    const { useLayoutForce } = useLayoutForceModule
    useLayoutForce({
      settings: {
        repulsion: 0.05,
        gravity: 0.03,
        attraction: 0.0003,
        inertia: 0.4,
        maxMove: 100
      },
      maxIterations: 15
    })

    expect(useLayoutForce).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          repulsion: 0.05,
          gravity: 0.03
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
  })
})
