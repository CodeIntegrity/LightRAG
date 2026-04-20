export const allGuestVisibleTabs = [
  'documents',
  'knowledge-graph',
  'prompt-management',
  'retrieval',
  'api',
] as const

export type GuestVisibleTab = (typeof allGuestVisibleTabs)[number]

const guestVisibleTabSet = new Set<string>(allGuestVisibleTabs)

export const normalizeGuestVisibleTabs = (
  value: unknown,
  fallback: readonly GuestVisibleTab[] = allGuestVisibleTabs
): GuestVisibleTab[] => {
  if (!Array.isArray(value)) {
    return [...fallback]
  }

  const normalized: GuestVisibleTab[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !guestVisibleTabSet.has(entry)) {
      continue
    }
    if (!normalized.includes(entry as GuestVisibleTab)) {
      normalized.push(entry as GuestVisibleTab)
    }
  }
  return normalized
}

export const resolveVisibleTabsForSession = (
  isGuestMode: boolean,
  guestVisibleTabs: readonly GuestVisibleTab[]
): GuestVisibleTab[] => {
  if (!isGuestMode) {
    return [...allGuestVisibleTabs]
  }
  return [...guestVisibleTabs]
}

export const resolveActiveTabForSession = (
  currentTab: string,
  visibleTabs: readonly GuestVisibleTab[]
): GuestVisibleTab => {
  if (visibleTabs.includes(currentTab as GuestVisibleTab)) {
    return currentTab as GuestVisibleTab
  }
  return visibleTabs[0] ?? 'documents'
}
