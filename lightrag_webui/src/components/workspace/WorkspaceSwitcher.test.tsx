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
  test('renders cached display name for the current workspace', async () => {
    const settings = await import('@/stores/settings')
    const originalCurrentSelector = settings.useSettingsStore.use.currentWorkspace
    const originalDisplayNameSelector = (settings.useSettingsStore.use as any).workspaceDisplayNames

    ;(settings.useSettingsStore.use as any).currentWorkspace = () => 'books'
    ;(settings.useSettingsStore.use as any).workspaceDisplayNames = () => ({
      books: 'Books Library'
    })

    const module = await import('./WorkspaceSwitcher')
    const html = renderToString(<module.default />)

    expect(html).toContain('Books Library')

    ;(settings.useSettingsStore.use as any).currentWorkspace = originalCurrentSelector
    ;(settings.useSettingsStore.use as any).workspaceDisplayNames = originalDisplayNameSelector
  })

  test('falls back to workspace key when no cached display name exists', async () => {
    const settings = await import('@/stores/settings')
    const originalCurrentSelector = settings.useSettingsStore.use.currentWorkspace
    const originalDisplayNameSelector = (settings.useSettingsStore.use as any).workspaceDisplayNames

    ;(settings.useSettingsStore.use as any).currentWorkspace = () => 'books'
    ;(settings.useSettingsStore.use as any).workspaceDisplayNames = () => ({})

    const module = await import('./WorkspaceSwitcher')
    const html = renderToString(<module.default />)

    expect(html).toContain('books')

    ;(settings.useSettingsStore.use as any).currentWorkspace = originalCurrentSelector
    ;(settings.useSettingsStore.use as any).workspaceDisplayNames = originalDisplayNameSelector
  })
})
