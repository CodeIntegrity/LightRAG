import { describe, expect, test } from 'vitest'
import {
  formatDocumentChunksForCopy,
  getDocumentDetailsCopyContent,
  shouldLoadDocumentChunks
} from './documentChunks'

describe('DocumentManager chunk copy formatting', () => {
  test('formats document chunks into readable copy text', () => {
    expect(
      formatDocumentChunksForCopy([
        { id: 'chunk-b', order: 0, content: 'Beta chunk body', tokens: 9 },
        { id: 'chunk-a', order: 1, content: 'Alpha chunk body', tokens: 12 }
      ])
    ).toBe(
      [
        '[1] chunk-b',
        'Beta chunk body',
        '',
        '[2] chunk-a',
        'Alpha chunk body'
      ].join('\n')
    )
  })

  test('uses chunks copy content for processed documents', () => {
    expect(
      getDocumentDetailsCopyContent({
        status: 'processed',
        details: 'Track ID: abc',
        chunks: [
          { id: 'chunk-a', order: 0, content: 'Alpha chunk body', tokens: 12 }
        ]
      })
    ).toBe('[1] chunk-a\nAlpha chunk body')
  })

  test('keeps status details copy content for non-processed documents', () => {
    expect(
      getDocumentDetailsCopyContent({
        status: 'failed',
        details: 'Error Message:\nboom',
        chunks: [
          { id: 'chunk-a', order: 0, content: 'Alpha chunk body', tokens: 12 }
        ]
      })
    ).toBe('Error Message:\nboom')
  })

  test('loads document chunks only for processed documents', () => {
    expect(shouldLoadDocumentChunks({ status: 'processed' })).toBe(true)
    expect(shouldLoadDocumentChunks({ status: 'failed' })).toBe(false)
  })
})
