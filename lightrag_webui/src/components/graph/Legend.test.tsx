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

vi.mock('@/stores/graph', () => ({
  useGraphStore: {
    use: {
      typeColorMap: () =>
        new Map<string, string>([
          ['PERSON', '#ff0000'],
          ['技术', '#00ff00']
        ])
    }
  }
}))

describe('Legend', () => {
  test('图例直接显示数据库原始类型值，不走多语言映射', async () => {
    const { default: Legend } = await import('./Legend')
    const html = renderToString(<Legend />)

    expect(html).toContain('Legend')
    expect(html).toContain('PERSON')
    expect(html).toContain('技术')
    expect(html).not.toContain('Person')
    expect(html).not.toContain('Technology')
  })
})
