import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLightragApiMock } from '@/test/apiMock'

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
  configurable: true
})

vi.mock('@/api/lightrag', () => createLightragApiMock())

describe('backend workspace create capability', () => {
  const healthyStatus = {
    status: 'healthy' as const,
    working_directory: '/tmp/rag',
    input_directory: '/tmp/input',
    configuration: {
      llm_binding: 'ollama',
      llm_binding_host: '',
      llm_model: 'demo',
      embedding_binding: 'ollama',
      embedding_binding_host: '',
      embedding_model: 'demo',
      kv_storage: 'JsonKVStorage',
      doc_status_storage: 'JsonDocStatusStorage',
      graph_storage: 'NetworkXStorage',
      vector_storage: 'NanoVectorDBStorage',
      workspace: '',
      max_graph_nodes: '10000',
      enable_rerank: false,
      rerank_binding: null,
      rerank_model: null,
      rerank_binding_host: null,
      summary_language: 'en',
      force_llm_summary_on_merge: false,
      max_parallel_insert: 2,
      max_async: 4,
      embedding_func_max_async: 4,
      embedding_batch_num: 8,
      cosine_threshold: 0.2,
      min_rerank_score: 0,
      related_chunk_number: 5,
    },
    capabilities: {
      workspace_create: true,
      guest_visible_tabs: ['documents', 'retrieval'],
    },
    pipeline_busy: true,
  }

  beforeEach(async () => {
    const { useSettingsStore } = await import('./settings')
    const { useGraphWorkbenchStore } = await import('./graphWorkbench')

    useSettingsStore.setState({
      graphMaxNodes: 1000,
      backendMaxGraphNodes: null
    })
    useGraphWorkbenchStore.getState().reset()
  })

  afterEach(async () => {
    const { useBackendState } = await import('./state')
    useBackendState.setState({
      workspaceCreateAllowed: false,
      status: null,
      message: null,
      messageTitle: null,
      allowPromptOverridesViaApi: false,
      activePromptVersions: null,
      pipelineBusy: false,
    } as never)
    const { useSettingsStore } = await import('./settings')
    const { useGraphWorkbenchStore } = await import('./graphWorkbench')
    useSettingsStore.setState({
      graphMaxNodes: 1000,
      backendMaxGraphNodes: null
    })
    useGraphWorkbenchStore.getState().reset()
    vi.clearAllMocks()
  })

  test('check stores workspace_create capability from health response', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')
    const { useSettingsStore } = await import('./settings')

    checkHealthMock.mockResolvedValue(healthyStatus)

    const ok = await useBackendState.getState().check()
    expect(ok).toBe(true)
    expect(useBackendState.getState().workspaceCreateAllowed).toBe(true)
    expect(useSettingsStore.getState().backendMaxGraphNodes).toBe(10000)
    expect(useSettingsStore.getState().graphMaxNodes).toBe(10000)
    expect(useBackendState.getState().guestVisibleTabs).toEqual(['documents', 'retrieval'])
  })

  test('syncs graph max nodes from backend configuration into workbench defaults', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')
    const { useGraphWorkbenchStore } = await import('./graphWorkbench')

    checkHealthMock.mockResolvedValue(healthyStatus)

    await useBackendState.getState().check()

    expect(useGraphWorkbenchStore.getState().filterDraft.scope.max_nodes).toBe(10000)
  })

  test('preserves a smaller graph setting while syncing workbench default on backend limit change', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')
    const { useSettingsStore } = await import('./settings')
    const { useGraphWorkbenchStore } = await import('./graphWorkbench')

    useSettingsStore.setState({
      graphMaxNodes: 500,
      backendMaxGraphNodes: 10000
    })
    useGraphWorkbenchStore.getState().reset()
    checkHealthMock.mockResolvedValue({
      ...healthyStatus,
      configuration: {
        ...healthyStatus.configuration,
        max_graph_nodes: '2000'
      }
    })

    await useBackendState.getState().check()

    expect(useSettingsStore.getState().graphMaxNodes).toBe(500)
    expect(useSettingsStore.getState().backendMaxGraphNodes).toBe(2000)
    expect(useGraphWorkbenchStore.getState().filterDraft.scope.max_nodes).toBe(2000)
  })

  test('clear resets workspace create capability and status together', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')

    checkHealthMock.mockResolvedValue(healthyStatus)
    await useBackendState.getState().check()
    useBackendState.getState().clear()

    expect(useBackendState.getState().workspaceCreateAllowed).toBe(false)
    expect(useBackendState.getState().status).toBeNull()
    expect(useBackendState.getState().pipelineBusy).toBe(false)
  })

  test('setErrorMessage clears stale status and workspace create capability', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')

    checkHealthMock.mockResolvedValue(healthyStatus)
    await useBackendState.getState().check()
    useBackendState.getState().setErrorMessage('boom', 'Error')

    expect(useBackendState.getState().workspaceCreateAllowed).toBe(false)
    expect(useBackendState.getState().status).toBeNull()
    expect(useBackendState.getState().pipelineBusy).toBe(false)
  })

  test('check error response clears stale status and workspace create capability', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')

    checkHealthMock
      .mockResolvedValueOnce(healthyStatus)
      .mockResolvedValueOnce({ status: 'error', message: 'unreachable' })

    await useBackendState.getState().check()
    const ok = await useBackendState.getState().check()

    expect(ok).toBe(false)
    expect(useBackendState.getState().workspaceCreateAllowed).toBe(false)
    expect(useBackendState.getState().status).toBeNull()
    expect(useBackendState.getState().pipelineBusy).toBe(false)
  })
})
