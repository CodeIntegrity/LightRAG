import { describe, expect, test } from 'vitest'

import { formatDocumentDetails, hasDocumentDetails } from './documentDetails'

describe('documentDetails helpers', () => {
  test('processed document shows details entry even without metadata', () => {
    expect(
      hasDocumentDetails({
        id: 'doc-1',
        content_summary: '',
        content_length: 0,
        status: 'processed',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        file_path: '/tmp/doc.md'
      })
    ).toBe(true)
  })

  test('formats metadata and error details', () => {
    expect(
      formatDocumentDetails({
        id: 'doc-1',
        content_summary: '',
        content_length: 0,
        status: 'failed',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        file_path: '/tmp/doc.md',
        track_id: 'track-1',
        error_msg: 'boom',
        metadata: {
          source: 'manual'
        }
      })
    ).toContain('Track ID: track-1')
  })
})
