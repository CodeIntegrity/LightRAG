import React from 'react'
import { describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

import en from '@/locales/en.json'

const resolveTranslation = (catalog: Record<string, unknown>, key: string): string | undefined => {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, catalog) as string | undefined
}

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    t: (key: string) => resolveTranslation(en as Record<string, unknown>, key) ?? key
  })
}))

describe('graph overlay states', () => {
  test('空图时显示 overlay，而不是 empty-graph-node', async () => {
    const { default: GraphCanvasOverlay } = await import('./GraphCanvasOverlay')
    const html = renderToString(<GraphCanvasOverlay viewState="empty" />)

    expect(html).toContain('No graph data')
    expect(html).not.toContain('empty-graph-node')
  })

  test('loading 与 theme switching 使用 i18n 文案', async () => {
    const { default: GraphCanvasOverlay } = await import('./GraphCanvasOverlay')
    const loadingHtml = renderToString(<GraphCanvasOverlay viewState="loading" />)
    const themeHtml = renderToString(
      <GraphCanvasOverlay viewState="ready" themeSwitching />
    )

    expect(loadingHtml).toContain('Loading graph data...')
    expect(themeHtml).toContain('Switching theme...')
  })
})
