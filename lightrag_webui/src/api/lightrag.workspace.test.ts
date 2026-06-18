import { describe, expect, test } from 'vitest'
import en from '@/locales/en.json'
import zh from '@/locales/zh.json'

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  },
  configurable: true
})

describe('workspace api helpers', () => {
  test('resolveWorkspaceHeader returns undefined for blank values and string for valid values', async () => {
    const module = await import('./lightrag')
    const { resolveWorkspaceHeader } = module

    expect(resolveWorkspaceHeader(undefined)).toBeUndefined()
    expect(resolveWorkspaceHeader(null)).toBeUndefined()
    expect(resolveWorkspaceHeader('')).toBeUndefined()
    expect(resolveWorkspaceHeader('   ')).toBeUndefined()
    expect(resolveWorkspaceHeader('books')).toBe('books')
  })

  test('setCurrentWorkspace updates the current workspace', async () => {
    const { useSettingsStore } = await import('@/stores/settings')

    useSettingsStore.setState({
      currentWorkspace: ''
    })

    useSettingsStore.getState().setCurrentWorkspace('books')
    const state = useSettingsStore.getState()

    expect(state.currentWorkspace).toBe('books')
  })

  test('clearWorkspaceDisplayNames removes cached workspace labels', async () => {
    const { useSettingsStore } = await import('@/stores/settings')

    useSettingsStore.setState({
      workspaceDisplayNames: {
        books: 'Books Library'
      }
    })

    useSettingsStore.getState().clearWorkspaceDisplayNames()
    expect(useSettingsStore.getState().workspaceDisplayNames).toEqual({})
  })

  test('workspaceManager locale keys exist across supported languages', () => {
    const locales = [en, zh] as Record<string, unknown>[]
    const requiredPaths = [
      'retrievePanel.querySettings.promptVersionLabel',
      'retrievePanel.querySettings.promptVersionTooltip',
      'retrievePanel.querySettings.promptVersionModes.active',
      'retrievePanel.querySettings.promptVersionModes.saved',
      'retrievePanel.querySettings.promptVersionModes.custom',
      'retrievePanel.querySettings.savedVersionPlaceholder',
      'workspaceManager.title',
      'workspaceManager.description',
      'workspaceManager.readyTitle',
      'workspaceManager.deletedTitle',
      'workspaceManager.createTitle',
      'workspaceManager.create',
      'workspaceManager.softDelete',
      'workspaceManager.restore',
      'workspaceManager.hardDelete',
      'workspaceManager.stats.docs',
      'workspaceManager.stats.capabilities',
      'workspaceManager.operation.state',
      'workspaceManager.operation.progress',
      'workspaceManager.operationStatus.running',
      'workspaceManager.capabilityLabels.storage_size_bytes',
      'workspaceManager.capabilityStatus.available',
      'workspaceManager.capabilityStatus.unsupported_by_backend'
    ]

    const getValueAtPath = (obj: Record<string, unknown>, path: string): unknown => {
      return path.split('.').reduce<unknown>((current, segment) => {
        if (current && typeof current === 'object') {
          return (current as Record<string, unknown>)[segment]
        }
        return undefined
      }, obj)
    }

    locales.forEach((locale) => {
      requiredPaths.forEach((path) => {
        expect(getValueAtPath(locale, path)).toBeTruthy()
      })
    })
  })

  test('workspaceManager locale no longer exposes prompt version display copy', () => {
    const locales = [en, zh] as Record<string, unknown>[]
    const getValueAtPath = (obj: Record<string, unknown>, path: string): unknown =>
      path.split('.').reduce<unknown>((current, segment) => {
        if (current && typeof current === 'object') {
          return (current as Record<string, unknown>)[segment]
        }
        return undefined
      }, obj)

    locales.forEach((locale) => {
      expect(getValueAtPath(locale, 'workspaceManager.stats.promptVersions')).toBeUndefined()
      expect(getValueAtPath(locale, 'workspaceManager.capabilityLabels.prompt_version_count')).toBeUndefined()
    })
  })

  test('guest workspace create copy exists in primary locales', () => {
    const getValueAtPath = (obj: Record<string, unknown>, path: string): unknown =>
      path.split('.').reduce<unknown>((current, segment) => {
        if (current && typeof current === 'object') {
          return (current as Record<string, unknown>)[segment]
        }
        return undefined
      }, obj)

    ;[en, zh].forEach((locale) => {
      expect(getValueAtPath(locale as Record<string, unknown>, 'workspaceManager.guestCreateHint')).toBeTruthy()
      expect(getValueAtPath(locale as Record<string, unknown>, 'workspaceManager.loginRequiredHint')).toBeTruthy()
    })
  })
})
