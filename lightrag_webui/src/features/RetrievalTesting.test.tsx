import { describe, expect, test } from 'vitest'

import { getQueryDataTabItems } from './RetrievalTesting'

describe('RetrievalTesting helpers', () => {
  test('returns empty arrays when retrieval data has not been loaded', () => {
    expect(getQueryDataTabItems(null, 'entities')).toEqual([])
    expect(getQueryDataTabItems(null, 'references')).toEqual([])
  })

  test('reads the active retrieval data tab safely', () => {
    const payload = {
      status: 'success',
      message: 'ok',
      data: {
        entities: [{ entity_name: 'Alpha' }],
        references: [{ reference_id: 'ref-1', file_path: '/tmp/a.md' }]
      },
      metadata: {}
    }

    expect(getQueryDataTabItems(payload, 'entities')).toEqual([{ entity_name: 'Alpha' }])
    expect(getQueryDataTabItems(payload, 'references')).toEqual([
      { reference_id: 'ref-1', file_path: '/tmp/a.md' }
    ])
    expect(getQueryDataTabItems(payload, 'chunks')).toEqual([])
  })
})
