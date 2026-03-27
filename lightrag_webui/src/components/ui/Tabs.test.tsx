import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs'

describe('Tabs', () => {
  test('inactive tab content uses hidden instead of invisible to avoid layout bleed', () => {
    const html = renderToString(
      <Tabs value="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="knowledge-graph">Knowledge Graph</TabsTrigger>
        </TabsList>
        <TabsContent value="documents">Documents Panel</TabsContent>
        <TabsContent value="knowledge-graph">Knowledge Graph Panel</TabsContent>
      </Tabs>
    )

    expect(html).toContain('Documents Panel')
    expect(html).toContain('Knowledge Graph Panel')
    expect(html).toContain('data-[state=inactive]:hidden')
    expect(html).not.toContain('data-[state=inactive]:invisible')
  })
})
