import { describe, expect, test } from 'vitest'

import {
  getRetrievalPromptSelectionMode,
  getSavedRetrievalPromptVersionId
} from './RetrievalPromptVersionSelector'

const versions = [
  {
    version_id: 'retrieval-v1',
    group_type: 'retrieval',
    version_name: 'Retrieval V1',
    version_number: 1,
    comment: '',
    created_at: '2026-04-02T00:00:00Z',
    payload: {}
  },
  {
    version_id: 'retrieval-v2',
    group_type: 'retrieval',
    version_name: 'Retrieval V2',
    version_number: 2,
    comment: '',
    created_at: '2026-04-02T00:00:00Z',
    payload: {}
  }
] as const

describe('RetrievalPromptVersionSelector helpers', () => {
  test('derives selection mode from selector value', () => {
    expect(getRetrievalPromptSelectionMode('active')).toBe('active')
    expect(getRetrievalPromptSelectionMode('custom')).toBe('custom')
    expect(getRetrievalPromptSelectionMode('retrieval-v1')).toBe('saved')
  })

  test('prefers the current saved version when it still exists', () => {
    expect(getSavedRetrievalPromptVersionId([...versions], 'retrieval-v2', 'retrieval-v1')).toBe(
      'retrieval-v2'
    )
  })

  test('falls back to the active saved version before the first version', () => {
    expect(getSavedRetrievalPromptVersionId([...versions], 'active', 'retrieval-v2')).toBe('retrieval-v2')
  })

  test('falls back to the first saved version when current and active values are unavailable', () => {
    expect(getSavedRetrievalPromptVersionId([...versions], 'missing', 'missing-active')).toBe(
      'retrieval-v1'
    )
  })

  test('returns null when there are no saved versions', () => {
    expect(getSavedRetrievalPromptVersionId([], 'active', null)).toBeNull()
  })
})
