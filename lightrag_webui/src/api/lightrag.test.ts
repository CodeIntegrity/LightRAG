import { afterEach, beforeAll, describe, expect, test } from 'bun:test'

type DocumentsRequest = {
  status_filter?: 'pending' | 'processing' | 'preprocessed' | 'processed' | 'failed' | null
  page: number
  page_size: number
  sort_field: 'created_at' | 'updated_at' | 'id' | 'file_path'
  sort_direction: 'asc' | 'desc'
}

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
  apiModule.__resetPaginatedDocumentRequestsForTests()
})

describe('getDocumentsPaginated', () => {
  test('normalizes legacy statuses responses for older backends', async () => {
    const request: DocumentsRequest = {
      status_filter: null,
      page: 2,
      page_size: 1,
      sort_field: 'updated_at',
      sort_direction: 'desc'
    }

    apiModule.__setPaginatedDocumentsPostForTests(async () => ({
      statuses: {
        PROCESSED: [
          {
            id: 'doc-2',
            content_summary: 'newer document',
            content_length: 20,
            status: 'processed',
            created_at: '2026-04-16T09:00:00Z',
            updated_at: '2026-04-16T10:00:00Z',
            file_path: 'newer.md'
          }
        ],
        PENDING: [
          {
            id: 'doc-1',
            content_summary: 'older document',
            content_length: 10,
            status: 'pending',
            created_at: '2026-04-16T07:00:00Z',
            updated_at: '2026-04-16T08:00:00Z',
            file_path: 'older.md'
          }
        ]
      }
    }) as any)

    await expect(apiModule.getDocumentsPaginated(request)).resolves.toEqual({
      documents: [
        {
          id: 'doc-1',
          content_summary: 'older document',
          content_length: 10,
          status: 'pending',
          created_at: '2026-04-16T07:00:00Z',
          updated_at: '2026-04-16T08:00:00Z',
          file_path: 'older.md'
        }
      ],
      pagination: {
        page: 2,
        page_size: 1,
        total_count: 2,
        total_pages: 2,
        has_next: false,
        has_prev: true
      },
      status_counts: {
        all: 2,
        pending: 1,
        processing: 0,
        preprocessed: 0,
        processed: 1,
        failed: 0
      }
    })
  })

  test('rejects malformed paginated responses instead of returning invalid state', async () => {
    const request: DocumentsRequest = {
      status_filter: null,
      page: 1,
      page_size: 20,
      sort_field: 'updated_at',
      sort_direction: 'desc'
    }

    apiModule.__setPaginatedDocumentsPostForTests(async () => '<html>login</html>' as any)

    await expect(apiModule.getDocumentsPaginated(request)).rejects.toThrow(
      'Unexpected paginated documents response format'
    )
  })

  test('issues a fresh request after aborting a timed-out in-flight request', async () => {
    const request: DocumentsRequest = {
      status_filter: null,
      page: 1,
      page_size: 20,
      sort_field: 'updated_at',
      sort_direction: 'desc'
    }

    let callCount = 0
    const resolvers: Array<(value: any) => void> = []

    apiModule.__setPaginatedDocumentsPostForTests((_request, controller) => {
      callCount += 1

      return new Promise((resolve, reject) => {
        resolvers.push(resolve)
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
    })

    const firstRequest = apiModule.getDocumentsPaginated(request)
    const secondRequest = apiModule.getDocumentsPaginated(request)

    expect(callCount).toBe(1)

    apiModule.abortDocumentsPaginated(request)
    const [firstResult, secondResult] = await Promise.allSettled([
      firstRequest,
      secondRequest
    ])
    expect(firstResult.status).toBe('rejected')
    expect(secondResult.status).toBe('rejected')

    const thirdRequest = apiModule.getDocumentsPaginated(request)
    expect(callCount).toBe(2)

    resolvers[1]({
      documents: [],
      pagination: {
        page: 1,
        page_size: 20,
        total_count: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false
      },
      status_counts: { all: 0 }
    })

    await expect(thirdRequest).resolves.toEqual({
      documents: [],
      pagination: {
        page: 1,
        page_size: 20,
        total_count: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false
      },
      status_counts: { all: 0 }
    })
  })

  test('times out hanging requests and allows a fresh retry', async () => {
    const request: DocumentsRequest = {
      status_filter: null,
      page: 1,
      page_size: 20,
      sort_field: 'updated_at',
      sort_direction: 'desc'
    }

    let callCount = 0
    const resolvers: Array<(value: any) => void> = []

    apiModule.__setPaginatedDocumentsPostForTests((_request, controller) => {
      callCount += 1

      return new Promise((resolve, reject) => {
        resolvers.push(resolve)
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
    })

    await expect(
      apiModule.getDocumentsPaginatedWithTimeout(request, 1)
    ).rejects.toThrow('Document fetch timeout')

    expect(callCount).toBe(1)

    const retryRequest = apiModule.getDocumentsPaginated(request)
    expect(callCount).toBe(2)

    resolvers[1]({
      documents: [],
      pagination: {
        page: 1,
        page_size: 20,
        total_count: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false
      },
      status_counts: { all: 0 }
    })

    await expect(retryRequest).resolves.toEqual({
      documents: [],
      pagination: {
        page: 1,
        page_size: 20,
        total_count: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false
      },
      status_counts: { all: 0 }
    })
  })

  test('does not abort a shared request when only one timeout subscriber expires', async () => {
    const request: DocumentsRequest = {
      status_filter: null,
      page: 1,
      page_size: 20,
      sort_field: 'updated_at',
      sort_direction: 'desc'
    }

    let callCount = 0
    let resolveSharedRequest: ((value: any) => void) | null = null
    let abortCount = 0

    apiModule.__setPaginatedDocumentsPostForTests((_request, controller) => {
      callCount += 1

      return new Promise((resolve, reject) => {
        resolveSharedRequest = resolve
        controller.signal.addEventListener(
          'abort',
          () => {
            abortCount += 1
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true }
        )
      })
    })

    const shortTimeoutRequest = apiModule.getDocumentsPaginatedWithTimeout(request, 1)
    const longTimeoutRequest = apiModule.getDocumentsPaginatedWithTimeout(request, 100)

    await expect(shortTimeoutRequest).rejects.toThrow('Document fetch timeout')

    expect(callCount).toBe(1)
    expect(abortCount).toBe(0)

    resolveSharedRequest?.({
      documents: [],
      pagination: {
        page: 1,
        page_size: 20,
        total_count: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false
      },
      status_counts: { all: 0 }
    })

    await expect(longTimeoutRequest).resolves.toEqual({
      documents: [],
      pagination: {
        page: 1,
        page_size: 20,
        total_count: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false
      },
      status_counts: { all: 0 }
    })
  })
})

describe('NDJSON parsing', () => {
  test('dispatches references and response from the same payload', () => {
    const chunks: string[] = []
    const references: Array<{ reference_id: string, file_path: string }> = []
    const errors: string[] = []

    apiModule.__dispatchNDJSONPayloadForTests(
      {
        references: [{ reference_id: '1', file_path: '/tmp/context.md' }],
        response: 'retrieved prompt content'
      },
      (chunk) => {
        chunks.push(chunk)
      },
      (error) => {
        errors.push(error)
      },
      (refs) => {
        references.push(...refs)
      }
    )

    expect(references).toEqual([{ reference_id: '1', file_path: '/tmp/context.md' }])
    expect(chunks).toEqual(['retrieved prompt content'])
    expect(errors).toEqual([])
  })
})
