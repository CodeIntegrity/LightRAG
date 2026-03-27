import React from 'react'
import { describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn()
  },
  configurable: true
})

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key
  })
}))

describe('WorkspaceSwitcher', () => {
  test('renders current workspace label', async () => {
    const settings = await import('@/stores/settings')
    const originalSelector = settings.useSettingsStore.use.currentWorkspace
    ;(settings.useSettingsStore.use as any).currentWorkspace = () => 'books'

    const module = await import('./WorkspaceSwitcher')
    const WorkspaceSwitcher = module.default

    const html = renderToString(<WorkspaceSwitcher />)

    expect(html).toContain('books')

    ;(settings.useSettingsStore.use as any).currentWorkspace = originalSelector
  })
})
