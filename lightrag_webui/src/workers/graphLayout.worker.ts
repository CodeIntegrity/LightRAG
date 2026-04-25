import { buildExpandedGraph, type GraphExpandWorkerInput } from '@/utils/graphLayout'

self.onmessage = (event: MessageEvent<GraphExpandWorkerInput>) => {
  self.postMessage(buildExpandedGraph(event.data))
}
