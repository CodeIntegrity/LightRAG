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

  test('resolveActiveTabForSession falls back to first visible tab when current tab is hidden', () => {
    expect(resolveActiveTabForSession('prompt-management', ['documents', 'api'])).toBe(
      'documents'
    )
  })
})
