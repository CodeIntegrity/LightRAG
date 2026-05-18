import { describe, expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const asyncSearchPropsRef: { current: Record<string, any> | null } = { current: null }

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@/components/ui/AsyncSearch', () => ({
  AsyncSearch: (props: Record<string, any>) => {
    asyncSearchPropsRef.current = props
    return createElement('div', { 'data-testid': 'async-search' })
  }
}))

describe('GraphSearch', () => {
  test('reset clears selected and focused search nodes', async () => {
    const { GraphSearchInput } = await import('@/components/graph/GraphSearch')
    const { useGraphStore } = await import('@/stores/graph')

    useGraphStore.getState().setFocusedNode('node-focus')
    useGraphStore.getState().setSelectedNode('node-selected', true, 'search')

    renderToStaticMarkup(
      createElement(GraphSearchInput, {
        onChange: () => undefined,
        onFocus: () => undefined,
        value: { id: 'node-selected', type: 'nodes' }
      })
    )

    expect(asyncSearchPropsRef.current).not.toBeNull()

    asyncSearchPropsRef.current!.onClear()

    expect(useGraphStore.getState().focusedNode).toBeNull()
    expect(useGraphStore.getState().selectedNode).toBeNull()
    expect(useGraphStore.getState().selectedNodeSource).toBeNull()
  })
})
