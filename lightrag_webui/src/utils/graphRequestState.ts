export type GraphRequestHandle = {
  requestId: number
  signal: AbortSignal
}

export const createGraphRequestState = () => {
  let requestId = 0
  let controller: AbortController | null = null

  return {
    start(): GraphRequestHandle {
      requestId += 1
      controller?.abort()
      controller = new AbortController()
      return {
        requestId,
        signal: controller.signal
      }
    },
    isCurrent(targetRequestId: number): boolean {
      return targetRequestId === requestId
    },
    abortCurrent(): void {
      controller?.abort()
      controller = null
    },
    reset(): void {
      controller?.abort()
      controller = null
      requestId = 0
    }
  }
}

export const isAbortError = (error: unknown): boolean => {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
