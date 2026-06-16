import { describe, expect, test } from 'vitest'

import {
  resolveActiveTabForSession,
  allGuestVisibleTabs,
  normalizeGuestVisibleTabs,
  resolveVisibleTabsForSession,
} from './guestFeatures'

describe('guestFeatures', () => {
  test('normalizeGuestVisibleTabs keeps known tabs and removes duplicates', () => {
    expect(
      normalizeGuestVisibleTabs(['documents', 'retrieval', 'documents', 'unknown'])
    ).toEqual(['documents', 'retrieval'])
  })

  test('resolveVisibleTabsForSession returns filtered tabs for guests', () => {
    expect(resolveVisibleTabsForSession(true, ['documents', 'api'])).toEqual([
      'documents',
      'api',
    ])
  })

  test('resolveVisibleTabsForSession returns all tabs for logged-in users', () => {
    expect(resolveVisibleTabsForSession(false, ['documents'])).toEqual([
      ...allGuestVisibleTabs,
    ])
  })

  test('resolveVisibleTabsForSession keeps prompts before retrieval', () => {
    expect(
      resolveVisibleTabsForSession(false, [
        'documents',
        'knowledge-graph',
        'prompts',
        'retrieval',
        'api',
      ])
    ).toEqual([
      'documents',
      'knowledge-graph',
      'prompts',
      'retrieval',
      'api',
    ])
  })

  test('resolveActiveTabForSession falls back to first visible tab when current tab is hidden', () => {
    expect(resolveActiveTabForSession('prompts', ['documents', 'api'])).toBe(
      'documents'
    )
  })
})
