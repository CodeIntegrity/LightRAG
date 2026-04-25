import { useCallback } from 'react'

import {
  buildExpandedGraph,
  type GraphExpandWorkerInput,
  type GraphExpandWorkerResult
} from '@/utils/graphLayout'

export const runGraphLayoutTask = (
  input: GraphExpandWorkerInput,
  createWorker?: (() => Worker) | null
): Promise<GraphExpandWorkerResult> => {
  if (createWorker) {
    return new Promise((resolve, reject) => {
      const worker = createWorker()
      worker.onmessage = (event: MessageEvent<GraphExpandWorkerResult>) => {
        worker.terminate()
        resolve(event.data)
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(event.error ?? new Error(event.message))
      }
      worker.postMessage(input)
    })
  }

  return Promise.resolve().then(() => buildExpandedGraph(input))
}

const useGraphLayoutWorker = () => {
  const runLayout = useCallback((input: GraphExpandWorkerInput) => {
    const workerFactory =
      typeof Worker === 'undefined'
        ? null
        : () =>
            new Worker(new URL('../workers/graphLayout.worker.ts', import.meta.url), {
              type: 'module'
            })

    return runGraphLayoutTask(input, workerFactory)
  }, [])

  return { runLayout }
}

export default useGraphLayoutWorker
