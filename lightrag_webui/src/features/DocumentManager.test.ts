import { describe, expect, test } from 'vitest'
import { formatDocumentChunksForCopy } from './documentChunks'

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
})
