import { describe, expect, test } from 'vitest'
import { TabsContent } from './Tabs'

describe('Tabs', () => {
  test('inactive tab content uses hidden instead of invisible to avoid layout bleed', () => {
    const element = (TabsContent as any).render(
      {
        value: 'knowledge-graph',
        children: 'Knowledge Graph Panel'
      },
      null
    )

    expect(element.props.children).toBe('Knowledge Graph Panel')
    expect(element.props.className).toContain('data-[state=inactive]:hidden')
    expect(element.props.className).toContain('data-[state=active]:block')
    expect(element.props.className).not.toContain('data-[state=inactive]:invisible')
    expect(element.props.forceMount).toBe(true)
  })
})
