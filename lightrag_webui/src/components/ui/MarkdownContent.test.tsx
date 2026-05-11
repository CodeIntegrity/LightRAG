import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToString } from 'react-dom/server'

import MarkdownContent from './MarkdownContent'
import { ThemeProviderContext } from '@/components/ThemeProvider'

const renderMarkdown = (content: string, allowHtml: boolean = false) =>
  renderToString(
    <ThemeProviderContext.Provider value={{ theme: 'light', setTheme: () => undefined }}>
      <MarkdownContent content={content} allowHtml={allowHtml} />
    </ThemeProviderContext.Provider>
  )

describe('MarkdownContent', () => {
  test('renders markdown emphasis', () => {
    const html = renderMarkdown('**bold**')

    expect(html).toContain('<strong>bold</strong>')
  })

  test('does not render raw html by default', () => {
    const html = renderMarkdown('<span>raw html</span>')

    expect(html).not.toContain('<span>raw html</span>')
    expect(html).toContain('raw html')
  })
})
