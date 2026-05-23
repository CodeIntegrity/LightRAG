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
}
)
