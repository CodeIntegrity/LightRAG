import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/lightrag', () => ({
  getPromptConfigVersion: vi.fn(),
  getPromptConfigVersions: vi.fn()
}))

import { getPromptConfigVersion, getPromptConfigVersions } from '@/api/lightrag'
import {
  clearRetrievalPromptCache,
  getCachedRetrievalPromptRegistry,
  getCachedRetrievalPromptVersion
} from './retrievalPromptCache'

const versionRecord = {
  version_id: 'retrieval-v1',
  group_type: 'retrieval' as const,
  version_name: 'Retrieval V1',
  version_number: 1,
  comment: '',
  created_at: '2026-04-25T00:00:00Z',
  payload: { query: { rag_response: '{context_data}' } }
}

afterEach(() => {
  vi.clearAllMocks()
  clearRetrievalPromptCache()
})

describe('retrievalPromptCache', () => {
  test('reuses the cached registry without a second API call', async () => {
    ;(getPromptConfigVersions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      group_type: 'retrieval',
      active_version_id: 'retrieval-v1',
      versions: [versionRecord]
    })

    await getCachedRetrievalPromptRegistry()
    await getCachedRetrievalPromptRegistry()

    expect(getPromptConfigVersions).toHaveBeenCalledTimes(1)
  })

  test('serves version payloads from the cached registry before fetching detail again', async () => {
    ;(getPromptConfigVersions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      group_type: 'retrieval',
      active_version_id: 'retrieval-v1',
      versions: [versionRecord]
    })

    await getCachedRetrievalPromptRegistry()
    const version = await getCachedRetrievalPromptVersion('retrieval-v1')

    expect(version).toEqual(versionRecord)
    expect(getPromptConfigVersion).not.toHaveBeenCalled()
  })
})
