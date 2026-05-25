import { afterEach, beforeAll, describe, expect, test } from 'bun:test'

type LightragApiModule = typeof import('./lightrag')

const storageMock = () => {
  const data = new Map<string, string>()

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    }
  }
}

let apiModule: LightragApiModule

beforeAll(async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock(),
    configurable: true
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storageMock(),
    configurable: true
  })

  apiModule = await import('./lightrag')
})

afterEach(() => {
  apiModule.__resetPromptHttpClientForTests()
})

describe('entity type prompt api client', () => {
  test('uses the prompt route contract for list read validate save and activate', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = []

    apiModule.__setPromptHttpClientForTests({
      get: async (url) => {
        calls.push({ method: 'get', url })
        return { data: { ok: true, url } }
      },
      post: async (url, data) => {
        calls.push({ method: 'post', url, data })
        return { data: { ok: true, url, data } }
      },
      put: async (url, data) => {
        calls.push({ method: 'put', url, data })
        return { data: { ok: true, url, data } }
      }
    })

    await apiModule.listEntityTypePrompts()
    await apiModule.readEntityTypePrompt('default--entity-type--v1.yml')
    await apiModule.validateEntityTypePrompt({
      content: 'entity_types_guidance: test\n',
      use_json: false
    })
    await apiModule.saveEntityTypePromptVersion('entity-type', 2, {
      content: 'entity_types_guidance: test\n',
      activate: true
    })
    await apiModule.activateEntityTypePrompt('default--entity-type--v2.yml')

    expect(calls).toEqual([
      { method: 'get', url: '/prompts/entity-type' },
      {
        method: 'get',
        url: '/prompts/entity-type/default--entity-type--v1.yml'
      },
      {
        method: 'post',
        url: '/prompts/entity-type/validate',
        data: {
          content: 'entity_types_guidance: test\n',
          use_json: false
        }
      },
      {
        method: 'put',
        url: '/prompts/entity-type/entity-type/versions/2',
        data: {
          content: 'entity_types_guidance: test\n',
          activate: true
        }
      },
      {
        method: 'post',
        url: '/prompts/entity-type/activate',
        data: {
          file_name: 'default--entity-type--v2.yml'
        }
      }
    ])
  })

  test('encodes path segments controlled by user input', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = []

    apiModule.__setPromptHttpClientForTests({
      get: async (url) => {
        calls.push({ method: 'get', url })
        return { data: {} }
      },
      post: async (url, data) => {
        calls.push({ method: 'post', url, data })
        return { data: {} }
      },
      put: async (url, data) => {
        calls.push({ method: 'put', url, data })
        return { data: {} }
      }
    })

    await apiModule.readEntityTypePrompt('default--entity type--v1.yml')
    await apiModule.saveEntityTypePromptVersion('entity type', 3, {
      content: 'entity_types_guidance: test\n',
      activate: false
    })

    expect(calls[0].url).toBe(
      '/prompts/entity-type/default--entity%20type--v1.yml'
    )
    expect(calls[1].url).toBe('/prompts/entity-type/entity%20type/versions/3')
  })

  test('assistEntityTypePrompt posts requirements/current_content/language and returns full response shape', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = []
    const backendResponse = {
      content: 'entity_types_guidance: ok\n',
      validation: { valid: true, errors: [] },
      warnings: [],
      raw_output: 'entity_types_guidance: ok\n',
      model: 'role-query-model'
    }

    apiModule.__setPromptHttpClientForTests({
      get: async () => ({ data: {} }),
      post: async (url, data) => {
        calls.push({ method: 'post', url, data })
        return { data: backendResponse }
      },
      put: async () => ({ data: {} })
    })

    const result = await apiModule.assistEntityTypePrompt({
      requirements: 'Generate medical entity types',
      current_content: 'entity_types_guidance: previous\n',
      language: 'zh'
    })

    // Endpoint + method + payload must match the backend contract.
    expect(calls).toEqual([
      {
        method: 'post',
        url: '/prompts/entity-type/assist',
        data: {
          requirements: 'Generate medical entity types',
          current_content: 'entity_types_guidance: previous\n',
          language: 'zh'
        }
      }
    ])
    // use_json must NOT be sent by the client.
    expect((calls[0].data as Record<string, unknown>).use_json).toBeUndefined()
    // Full response (incl. raw_output and model) is passed through.
    expect(result).toEqual(backendResponse)
  })

  test('assistEntityTypePrompt omits current_content and language when not provided', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = []

    apiModule.__setPromptHttpClientForTests({
      get: async () => ({ data: {} }),
      post: async (url, data) => {
        calls.push({ method: 'post', url, data })
        return {
          data: {
            content: '',
            validation: { valid: false, errors: ['empty'] },
            warnings: [],
            raw_output: '',
            model: null
          }
        }
      },
      put: async () => ({ data: {} })
    })

    await apiModule.assistEntityTypePrompt({ requirements: 'minimal' })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/prompts/entity-type/assist')
    // Payload should only carry fields that were explicitly provided so the
    // backend can apply its own defaults (language="auto", use_json runtime).
    expect(calls[0].data).toEqual({ requirements: 'minimal' })
  })
}
)
