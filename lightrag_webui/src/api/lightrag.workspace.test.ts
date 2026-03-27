import { describe, expect, test } from 'vitest'
import ar from '@/locales/ar.json'
import de from '@/locales/de.json'
import en from '@/locales/en.json'
import fr from '@/locales/fr.json'
import ja from '@/locales/ja.json'
import ko from '@/locales/ko.json'
import ru from '@/locales/ru.json'
import uk from '@/locales/uk.json'
import vi from '@/locales/vi.json'
import zh from '@/locales/zh.json'
import zhTW from '@/locales/zh_TW.json'

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

  test('setCurrentWorkspace resets workspace-sensitive prompt state', async () => {
    const { useSettingsStore } = await import('@/stores/settings')

    useSettingsStore.setState({
      currentWorkspace: '',
      promptManagementSelectedVersionId: 'version-1',
      retrievalPromptVersionSelection: 'custom',
      retrievalPromptDraft: {
        query: {
          rag_response: 'draft'
        }
      }
    })

    useSettingsStore.getState().setCurrentWorkspace('books')
    const state = useSettingsStore.getState()

    expect(state.currentWorkspace).toBe('books')
    expect(state.promptManagementSelectedVersionId).toBeNull()
    expect(state.retrievalPromptVersionSelection).toBe('active')
    expect(state.retrievalPromptDraft).toBeUndefined()
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
    const locales = [ar, de, en, fr, ja, ko, ru, uk, vi, zh, zhTW] as Record<string, unknown>[]
    const requiredPaths = [
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
      'workspaceManager.stats.promptVersions',
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
