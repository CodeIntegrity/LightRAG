import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

vi.mock('@/components/ui/Popover', () => ({
  Popover: ({ children }: { children: unknown }) => createElement('div', null, children),
  PopoverTrigger: ({ children }: { children: unknown }) => createElement('div', null, children),
  PopoverContent: ({ children, className }: { children: unknown; className?: string }) =>
    createElement('div', { className }, children)
}))

vi.mock('@/components/ui/Button', () => ({
  default: ({
    children,
    className,
    onClick,
    ...props
  }: {
    children?: unknown
    className?: string
    onClick?: () => void
  }) => createElement('button', { className, onClick, ...props }, children)
}))

vi.mock('@/components/ui/Checkbox', () => ({
  default: ({
    checked,
    id
  }: {
    checked: boolean
    id: string
  }) => createElement('input', { defaultChecked: checked, id, readOnly: true, type: 'checkbox' })
}))

vi.mock('@/components/ui/Separator', () => ({
  default: () => createElement('hr')
}))

vi.mock('@/components/ui/Input', () => ({
  default: ({
    className,
    id,
    type,
    value
  }: {
    className?: string
    id?: string
    type?: string
    value?: string | number
  }) => createElement('input', { className, defaultValue: value, id, readOnly: true, type })
}))

describe('Settings', () => {
  beforeEach(async () => {
    const { useSettingsStore } = await import('@/stores/settings')

    useSettingsStore.setState({
      showNodeLabel: true,
      showEdgeLabel: true,
      graphLabelFontSize: 12
    })
  })

  test('keeps the original label control order and narrows the font-size input', async () => {
    const { default: Settings } = await import('@/components/graph/Settings')

    const markup = renderToStaticMarkup(createElement(Settings))

    expect(markup).toContain('graphPanel.sideBar.settings.showNodeLabel')
    expect(markup).toContain('graphPanel.sideBar.settings.showEdgeLabel')
    expect(markup).toContain('graphPanel.sideBar.settings.graphLabelFontSize')
    expect(markup).toContain('w-24')
    expect(markup).not.toContain('md:grid-cols-[minmax(0,1fr)_auto]')
  })
})
