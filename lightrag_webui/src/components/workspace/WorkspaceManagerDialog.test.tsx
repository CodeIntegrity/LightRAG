import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { toast } from 'sonner'

import en from '@/locales/en.json'
import { useSettingsStore } from '@/stores/settings'

let autoSubmitWorkspaceCreateForm = false
let capturedWorkspaceSwitchClick: (() => void) | null = null
let capturedHardDeleteClick: (() => void) | null = null

const getNodeText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (!React.isValidElement(node)) {
    return ''
  }

  const props = node.props as { children?: React.ReactNode }
  return React.Children.toArray(props.children)
    .map((child) => getNodeText(child))
    .join('')
}

const triggerWorkspaceCreateSubmit = (node: React.ReactNode): void => {
  if (!autoSubmitWorkspaceCreateForm || !React.isValidElement(node)) {
    return
  }

  if (node.type === 'form' && typeof (node.props as { onSubmit?: unknown }).onSubmit === 'function') {
    ;((node.props as { onSubmit: (event?: { preventDefault?: () => void }) => void }).onSubmit)({
      preventDefault: () => undefined
    })
    return
  }

  const props = node.props as { children?: React.ReactNode }
  const children = React.Children.toArray(props.children)
  children.forEach((child) => {
    triggerWorkspaceCreateSubmit(child)
  })
}

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

vi.mock('@/components/ui/Button', () => ({
  default: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void }) => {
    const text = getNodeText(children)

    if (typeof onClick === 'function' && text.includes('Switch')) {
      capturedWorkspaceSwitchClick = onClick
    }

    if (typeof onClick === 'function' && text.includes('Hard Delete')) {
      capturedHardDeleteClick = onClick
    }

    return <button onClick={onClick} {...props}>{children}</button>
  }
}))

vi.mock('@/components/ui/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => {
    triggerWorkspaceCreateSubmit(children)
    return <div>{children}</div>
  },
  DialogContent: ({
    children,
    className
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  DialogDescription: ({
    children,
    className
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  DialogFooter: ({
    children,
    className
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  DialogHeader: ({
    children,
    className
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  DialogTitle: ({
    children,
    className
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>
}))

vi.mock('@/api/lightrag', () => ({
  checkHealth: vi.fn(async () => ({ status: 'healthy', capabilities: {} })),
  createWorkspace: vi.fn(),
  getWorkspaceOperation: vi.fn(),
  getWorkspaceStats: vi.fn(),
  hardDeleteWorkspace: vi.fn(),
  listWorkspaces: vi.fn(async () => ({ workspaces: [] })),
  restoreWorkspace: vi.fn(),
  softDeleteWorkspace: vi.fn()
}))

afterEach(async () => {
  vi.restoreAllMocks()
  const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
  getItemMock.mockImplementation(() => null)
  useSettingsStore.setState({
    currentWorkspace: '',
    workspaceDisplayNames: {}
  })
  const { useBackendState } = await import('@/stores/state')
  useBackendState.setState({
    workspaceCreateAllowed: false
  } as never)
  autoSubmitWorkspaceCreateForm = false
  capturedWorkspaceSwitchClick = null
  capturedHardDeleteClick = null
})

describe('WorkspaceManagerDialog', () => {
  test('getWorkspacesNeedingStats only auto-loads the active ready workspace', async () => {
    const module = await import('./WorkspaceManagerDialog')

    expect(
      module.getWorkspacesNeedingStats(
        [
          { workspace: 'books', status: 'ready' },
          { workspace: 'trash', status: 'hard_deleting' },
          { workspace: 'notes', status: 'ready' }
        ] as any,
        'notes',
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

  test('shouldRefreshWorkspacesAfterOperationError returns true for missing workspaces only', async () => {
    const module = await import('./WorkspaceManagerDialog')

    expect(module.shouldRefreshWorkspacesAfterOperationError({ response: { status: 404 } })).toBe(true)
    expect(module.shouldRefreshWorkspacesAfterOperationError(new Error('boom'))).toBe(false)
    expect(module.shouldRefreshWorkspacesAfterOperationError({ response: { status: 500 } })).toBe(false)
  })

  test('shouldDisableSoftDelete returns true only for the current workspace', async () => {
    const module = await import('./WorkspaceManagerDialog')

    expect(module.shouldDisableSoftDelete('books', 'books')).toBe(true)
    expect(module.shouldDisableSoftDelete('books', 'notes')).toBe(false)
    expect(module.shouldDisableSoftDelete('books', '')).toBe(false)
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

  test('keeps create button enabled for base64url admin tokens', async () => {
    const { useBackendState } = await import('@/stores/state')
    vi.spyOn(useBackendState.use, 'workspaceCreateAllowed').mockReturnValue(true)

    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiJhbGljZSIsIm1ldGFkYXRhIjp7IngiOiJ-fiJ9fQ.signature'
        : null
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[], noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['workspace_alpha', noop]) as never)
      .mockImplementationOnce((() => ['Workspace Alpha', noop]) as never)
      .mockImplementationOnce((() => ['A shared workspace', noop]) as never)
      .mockImplementationOnce((() => ['private', noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const WorkspaceManagerDialog = module.default

    const html = renderToString(
      <WorkspaceManagerDialog open onOpenChange={() => undefined} />
    )

    expect(html).not.toContain('disabled=""')
    expect(html).toContain('Create Workspace')
  })

  test('shows login-required hint and disabled button for guest tokens even when backend capability allows it', async () => {
    const { useBackendState } = await import('@/stores/state')
    vi.spyOn(useBackendState.use, 'workspaceCreateAllowed').mockReturnValue(true)

    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiZ3Vlc3QiLCJzdWIiOiJndWVzdCJ9.signature'
        : null
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[], noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['guest_ws', noop]) as never)
      .mockImplementationOnce((() => ['Guest WS', noop]) as never)
      .mockImplementationOnce((() => ['guest workspace', noop]) as never)
      .mockImplementationOnce((() => ['private', noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const html = renderToString(<module.default open onOpenChange={() => undefined} />)

    expect(html).toContain('Log in to create workspaces.')
    expect(html).toContain('disabled=""')
  })

  test('shows login-required hint and disabled button when guest create capability is false', async () => {
    const { useBackendState } = await import('@/stores/state')
    vi.spyOn(useBackendState.use, 'workspaceCreateAllowed').mockReturnValue(false)

    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiZ3Vlc3QiLCJzdWIiOiJndWVzdCJ9.signature'
        : null
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[], noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['guest_ws', noop]) as never)
      .mockImplementationOnce((() => ['Guest WS', noop]) as never)
      .mockImplementationOnce((() => ['guest workspace', noop]) as never)
      .mockImplementationOnce((() => ['private', noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const html = renderToString(<module.default open onOpenChange={() => undefined} />)

    expect(html).toContain('Log in to create workspaces.')
    expect(html).toContain('disabled=""')
  })

  test('shows login-required hint and disabled button when no token is present', async () => {
    const { useBackendState } = await import('@/stores/state')
    vi.spyOn(useBackendState.use, 'workspaceCreateAllowed').mockReturnValue(true)

    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockReturnValue(null)

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[], noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['guest_ws', noop]) as never)
      .mockImplementationOnce((() => ['Guest WS', noop]) as never)
      .mockImplementationOnce((() => ['guest workspace', noop]) as never)
      .mockImplementationOnce((() => ['private', noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const html = renderToString(<module.default open onOpenChange={() => undefined} />)

    expect(html).toContain('Log in to create workspaces.')
    expect(html).toContain('disabled=""')
  })

  test('uses the approved responsive breakpoints for overview and main layout', async () => {
    const module = await import('./WorkspaceManagerDialog')
    const html = renderToString(<module.default open onOpenChange={() => undefined} />)

    expect(html).toContain('sm:grid-cols-2 lg:grid-cols-3')
    expect(html).toContain('lg:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]')
    expect(html).not.toContain('xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]')
  })

  test('uses a dedicated scroll container so low-height screens can reach hidden actions', async () => {
    const module = await import('./WorkspaceManagerDialog')
    const html = renderToString(<module.default open onOpenChange={() => undefined} />)

    expect(html).toContain('flex max-h-[90vh] max-w-6xl flex-col overflow-hidden p-0')
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto px-6 py-6')
    expect(html).toContain('shrink-0 border-t border-border/60 px-6 py-4')
  })

  test('refreshes backend capability when create is denied by session policy', async () => {
    const { useBackendState } = await import('@/stores/state')
    vi.spyOn(useBackendState.use, 'workspaceCreateAllowed').mockReturnValue(true)
    const checkSpy = vi.spyOn(useBackendState.getState(), 'check').mockResolvedValue(true)
    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiJhbGljZSJ9.signature'
        : null
    )

    const api = await import('@/api/lightrag')
    const createWorkspaceMock = api.createWorkspace as unknown as ReturnType<typeof vi.fn>
    createWorkspaceMock.mockRejectedValue(
      new Error('403 Forbidden\n{"detail":"Workspace creation is not allowed for this session"}\n/workspaces')
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[], noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['guest_ws', noop]) as never)
      .mockImplementationOnce((() => ['Guest WS', noop]) as never)
      .mockImplementationOnce((() => ['guest workspace', noop]) as never)
      .mockImplementationOnce((() => ['private', noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    autoSubmitWorkspaceCreateForm = true
    renderToString(<module.default open onOpenChange={() => undefined} />)
    await Promise.resolve()
    await Promise.resolve()
    autoSubmitWorkspaceCreateForm = false

    expect(toast.error).toHaveBeenCalled()
    expect(checkSpy).toHaveBeenCalledTimes(1)
  })

  test('blocks invalid workspace identifiers before calling createWorkspace', async () => {
    const { useBackendState } = await import('@/stores/state')
    vi.spyOn(useBackendState.use, 'workspaceCreateAllowed').mockReturnValue(true)
    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiJhbGljZSJ9.signature'
        : null
    )

    const api = await import('@/api/lightrag')
    const createWorkspaceMock = api.createWorkspace as unknown as ReturnType<typeof vi.fn>
    createWorkspaceMock.mockReset()

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[], noop]) as never)
      .mockImplementationOnce((() => [false, noop]) as never)
      .mockImplementationOnce((() => ['作业回顾', noop]) as never)
      .mockImplementationOnce((() => ['作业回顾', noop]) as never)
      .mockImplementationOnce((() => ['', noop]) as never)
      .mockImplementationOnce((() => ['private', noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    autoSubmitWorkspaceCreateForm = true
    renderToString(<module.default open onOpenChange={() => undefined} />)
    await Promise.resolve()
    await Promise.resolve()
    autoSubmitWorkspaceCreateForm = false

    expect(createWorkspaceMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Workspace key can only contain letters, numbers, and underscores.'
    )
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

  test('hard delete action is hidden for hard-deleting and hard-deleted workspaces', async () => {
    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiJhbGljZSJ9.signature'
        : null
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[
        {
          workspace: 'trash',
          display_name: 'Trash',
          description: 'running delete',
          status: 'hard_deleting',
          visibility: 'private',
          created_by: 'alice',
          owners: ['alice'],
          is_default: false,
          is_protected: false
        },
        {
          workspace: 'archive',
          display_name: 'Archive',
          description: 'already deleted',
          status: 'hard_deleted',
          visibility: 'private',
          created_by: 'alice',
          owners: ['alice'],
          is_default: false,
          is_protected: false
        }
      ], noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const html = renderToString(<module.default open onOpenChange={() => undefined} />)

    expect(html).not.toContain('Hard Delete')
  })

  test('hard delete action remains available for delete-failed workspaces', async () => {
    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiJhbGljZSJ9.signature'
        : null
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[
        {
          workspace: 'archive',
          display_name: 'Archive',
          description: 'failed delete',
          status: 'delete_failed',
          visibility: 'private',
          created_by: 'alice',
          owners: ['alice'],
          is_default: false,
          is_protected: false,
          delete_error: 'boom'
        }
      ], noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    const html = renderToString(<module.default open onOpenChange={() => undefined} />)

    expect(html).toContain('Hard Delete')
  })

  test('reloads the page after switching workspace', async () => {
    useSettingsStore.setState({
      currentWorkspace: 'books',
      workspaceDisplayNames: {
        books: 'Books',
        notes: 'Notes'
      }
    })

    const reloadSpy = vi.fn()
    const originalWindow = (globalThis as { window?: { location?: { reload?: () => void } } }).window
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          reload: reloadSpy
        }
      },
      configurable: true
    })

    const onOpenChange = vi.fn()
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
          workspace: 'notes',
          display_name: 'Notes',
          description: 'desc',
          status: 'ready',
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
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    renderToString(<module.default open onOpenChange={onOpenChange} />)
    capturedWorkspaceSwitchClick?.()

    expect(capturedWorkspaceSwitchClick).not.toBeNull()
    expect(useSettingsStore.getState().currentWorkspace).toBe('notes')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(reloadSpy).toHaveBeenCalledTimes(1)

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true
      })
    }
  })

  test('interpolates workspace name in hard delete prompt', async () => {
    const originalWindow = (globalThis as { window?: { prompt?: (value?: string) => string | null; location?: { reload?: () => void } } }).window
    const promptSpy = vi.fn(() => 'archive')
    Object.defineProperty(globalThis, 'window', {
      value: {
        prompt: promptSpy,
        location: {
          reload: vi.fn()
        }
      },
      configurable: true
    })

    const api = await import('@/api/lightrag')
    const hardDeleteWorkspaceMock = api.hardDeleteWorkspace as unknown as ReturnType<typeof vi.fn>
    hardDeleteWorkspaceMock.mockResolvedValue({
      operation: {
        workspace: 'archive',
        state: 'running',
        kind: 'hard_delete'
      }
    })

    const getItemMock = localStorage.getItem as unknown as ReturnType<typeof vi.fn>
    getItemMock.mockImplementation((key: string) =>
      key === 'LIGHTRAG-API-TOKEN'
        ? 'header.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiJhbGljZSJ9.signature'
        : null
    )

    const ReactModule = await import('react')
    const actualUseState = ReactModule.useState
    const noop = () => undefined

    vi.spyOn(ReactModule, 'useState')
      .mockImplementationOnce((() => [[
        {
          workspace: 'archive',
          display_name: 'Archive',
          description: 'deleted',
          status: 'soft_deleted',
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
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementationOnce((() => [{}, noop]) as never)
      .mockImplementation(actualUseState as never)

    const module = await import('./WorkspaceManagerDialog')
    renderToString(<module.default open onOpenChange={() => undefined} />)
    capturedHardDeleteClick?.()

    expect(capturedHardDeleteClick).not.toBeNull()
    expect(promptSpy).toHaveBeenCalledWith('Type archive to confirm hard delete')
    expect(hardDeleteWorkspaceMock).toHaveBeenCalledWith('archive')

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true
      })
    }
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
      .mockImplementationOnce((() => [{}, noop]) as never)
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
    expect(normalizedHtml).toContain('State:')
    expect(normalizedHtml).toContain('Running')
    expect(normalizedHtml).not.toContain('Capabilities')
    expect(normalizedHtml).toContain('Progress')
    expect(normalizedHtml).toContain('active_requests_remaining: 2')
  })
})
