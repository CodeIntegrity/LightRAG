import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/lightrag', async () => {
  return {
    checkHealth: vi.fn(),
  }
})

describe('backend workspace create capability', () => {
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
  })

  test('check stores workspace_create capability from health response', async () => {
    const api = await import('@/api/lightrag')
    const checkHealthMock = api.checkHealth as unknown as ReturnType<typeof vi.fn>
    const { useBackendState } = await import('./state')

    checkHealthMock.mockResolvedValue({
      status: 'healthy',
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
        max_graph_nodes: '1000',
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
      },
      pipeline_busy: false,
    })

    const ok = await useBackendState.getState().check()
    expect(ok).toBe(true)
    expect(useBackendState.getState().workspaceCreateAllowed).toBe(true)
  })
})
