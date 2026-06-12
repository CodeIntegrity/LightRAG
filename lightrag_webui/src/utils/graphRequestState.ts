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
    isActive(targetRequestId: number): boolean {
      return (
        targetRequestId === requestId &&
        controller !== null &&
        !controller.signal.aborted
      )
    },
    hasActive(): boolean {
      return controller !== null && !controller.signal.aborted
    },
    finish(targetRequestId: number): void {
      if (targetRequestId === requestId) {
        controller = null
      }
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
