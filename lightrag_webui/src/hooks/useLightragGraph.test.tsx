import { describe, expect, test } from 'vitest'

import {
  buildExpandedGraph,
  type GraphExpandWorkerInput
} from '@/utils/graphLayout'
import { createGraphRequestState } from '@/utils/graphRequestState'

describe('useLightragGraph request lifecycle', () => {
  test('只允许最后一次查询结果写入 store', () => {
    const requestState = createGraphRequestState()
    const first = requestState.start()
    const second = requestState.start()

    expect(first.signal.aborted).toBe(true)
    expect(requestState.isCurrent(first.requestId)).toBe(false)
    expect(requestState.isCurrent(second.requestId)).toBe(true)
  })
})

describe('graph expand worker path', () => {
  test('节点展开使用异步 worker 结果', async () => {
    const { runGraphLayoutTask } = await import('./useGraphLayoutWorker')
    const input: GraphExpandWorkerInput = {
      expandedNodeId: 'root',
      expandedNodeSize: 12,
      cameraRatio: 1,
      existingNodes: [{ id: 'root', x: 0, y: 0, degree: 1 }],
      existingEdges: [],
      incomingNodes: [
        {
          id: 'root',
          labels: ['root'],
          properties: { entity_id: 'root' },
          size: 12,
          x: 0,
          y: 0,
          color: '#000',
          degree: 1
        },
        {
          id: 'child',
          labels: ['child'],
          properties: { entity_id: 'child' },
          size: 10,
          x: 0,
          y: 0,
          color: '#111',
          degree: 0
        }
      ],
      incomingEdges: [
        {
          id: 'root-child',
          source: 'root',
          target: 'child',
          properties: { weight: 1 },
          dynamicId: ''
        }
      ]
    }

    let settled = false
    const promise = runGraphLayoutTask(input, null).then((result) => {
      settled = true
      return result
    })

    expect(settled).toBe(false)
    const result = await promise
    const directResult = buildExpandedGraph(input)

    expect(result.nodesToAdd).toHaveLength(1)
    expect(result.nodesToAdd[0].id).toBe('child')
    expect(result).toEqual(directResult)
  })
})
