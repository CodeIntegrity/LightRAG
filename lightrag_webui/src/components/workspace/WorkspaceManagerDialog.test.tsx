import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

import en from '@/locales/en.json'
import { useSettingsStore } from '@/stores/settings'

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn()
  },
  configurable: true
})

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    t: (
      key: string,
      options?: string | { defaultValue?: string; [key: string]: string | number | undefined }
    ) => {
      const translated = key.split('.').reduce<unknown>((current, segment) => {
        if (current && typeof current === 'object') {
          return (current as Record<string, unknown>)[segment]
        }
        return undefined
      }, en as Record<string, unknown>)
      if (typeof translated === 'string') {
        if (!options || typeof options === 'string') {
          return translated
        }
        return translated.replace(/\{\{(\w+)\}\}/g, (_, token) =>
          String(options[token] ?? '')
        )
      }
      if (typeof options === 'string') {
        return options
      }
      if (options?.defaultValue) {
        return options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_, token) =>
          String(options[token] ?? '')
        )
      }
      return key
    }
  })
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

vi.mock('@/components/ui/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@/api/lightrag', () => ({
  createWorkspace: vi.fn(),
  getWorkspaceOperation: vi.fn(),
  getWorkspaceStats: vi.fn(),
  hardDeleteWorkspace: vi.fn(),
  listWorkspaces: vi.fn(async () => ({ workspaces: [] })),
  restoreWorkspace: vi.fn(),
  softDeleteWorkspace: vi.fn()
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WorkspaceManagerDialog', () => {
  test('getWorkspacesNeedingStats returns ready workspaces missing cached stats', async () => {
    const module = await import('./WorkspaceManagerDialog')

    expect(
      module.getWorkspacesNeedingStats(
        [
          { workspace: 'books', status: 'ready' },
          { workspace: 'trash', status: 'hard_deleting' },
          { workspace: 'notes', status: 'ready' }
        ] as any,
        {
          books: {
            document_count: 1,
            entity_count: null,
            relation_count: null,
            chunk_count: null,
            storage_size_bytes: null,
            prompt_version_count: 1,
            capabilities: {}
          }
        }
      )
    ).toEqual(['notes'])
  })

  test('getWorkspacesNeedingOperationSync distinguishes initial fetch and polling targets', async () => {
    const module = await import('./WorkspaceManagerDialog')

    const workspaces = [
      { workspace: 'trash', status: 'hard_deleting' },
      { workspace: 'archive', status: 'soft_deleted' },
      { workspace: 'books', status: 'ready' }
    ] as any

    const operations = {
      archive: {
        workspace: 'archive',
        state: 'failed'
      },
      trash: {
        workspace: 'trash',
        state: 'running'
      }
    } as any

    expect(module.getWorkspacesNeedingOperationFetch(workspaces, {} as any)).toEqual(['trash', 'archive'])
    expect(module.getRunningOperationWorkspaces(operations)).toEqual(['trash'])
  })

  test('renders create workspace form when open', async () => {
    const module = await import('./WorkspaceManagerDialog')
    const WorkspaceManagerDialog = module.default

    const html = renderToString(
      <WorkspaceManagerDialog open onOpenChange={() => undefined} />
    )

    expect(html).toContain('Create Workspace')
    expect(html).toContain('workspace_name')
  })

  test('admin-only hard delete action is hidden when no admin token is present', async () => {
    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[
        {
          workspace: 'books',
          display_name: 'Books',
          description: 'desc',
          status: 'soft_deleted',
          visibility: 'private',
          created_by: 'alice',
          owners: ['alice'],
          is_default: false,
          is_protected: false
        }
      ], noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const WorkspaceManagerDialog = module.default

    const html = renderToString(
      <WorkspaceManagerDialog open onOpenChange={() => undefined} />
    )

    expect(html).not.toContain('Hard Delete')
  })

  test('renders workspace stats and delete operation summaries when state is present', async () => {
    useSettingsStore.setState({
      currentWorkspace: 'books'
    })

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[
        {
          workspace: 'books',
          display_name: 'Books',
          description: 'desc',
          status: 'ready',
          visibility: 'private',
          created_by: 'alice',
          owners: ['alice'],
          is_default: false,
          is_protected: false
        },
        {
          workspace: 'trash',
          display_name: 'Trash',
          description: 'deleted',
          status: 'hard_deleting',
          visibility: 'private',
          created_by: 'alice',
          owners: ['alice'],
          is_default: false,
          is_protected: false
        }
      ], noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => ['private', noop]) as never)
      .mockImplementationOnce((() => [{
        books: {
          document_count: 12,
          entity_count: null,
          relation_count: null,
          chunk_count: null,
          storage_size_bytes: null,
          prompt_version_count: 3,
          capabilities: {
            document_count: 'available',
            prompt_version_count: 'available',
            storage_size_bytes: 'unsupported_by_backend'
          }
        }
      }, noop]) as never)
      .mockImplementationOnce((() => [{
        trash: {
          workspace: 'trash',
          state: 'running',
          kind: 'hard_delete',
          progress: {
            active_requests_remaining: '2'
          }
        }
      }, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const WorkspaceManagerDialog = module.default

    const html = renderToString(
      <WorkspaceManagerDialog open onOpenChange={() => undefined} />
    )
    const normalizedHtml = html.replaceAll('<!-- -->', '')

    expect(normalizedHtml).toContain('12 docs')
    expect(normalizedHtml).toContain('3 prompt versions')
    expect(normalizedHtml).toContain('Storage size: Unsupported by backend')
    expect(normalizedHtml).toContain('State:')
    expect(normalizedHtml).toContain('Running')
    expect(normalizedHtml).toContain('Capabilities')
    expect(normalizedHtml).toContain('Progress')
    expect(normalizedHtml).toContain('active_requests_remaining: 2')
  })
})
