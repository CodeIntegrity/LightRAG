import * as Constants from '@/lib/constants'
import type { RawEdgeType, RawNodeType } from '@/stores/graph'

export type GraphLayoutExistingNode = {
  id: string
  x: number
  y: number
  degree: number
}

export type GraphLayoutExistingEdge = {
  source: string
  target: string
}

export type GraphExpandWorkerInput = {
  expandedNodeId: string
  expandedNodeSize: number
  cameraRatio: number
  existingNodes: GraphLayoutExistingNode[]
  existingEdges: GraphLayoutExistingEdge[]
  incomingNodes: RawNodeType[]
  incomingEdges: RawEdgeType[]
}

export type GraphExpandWorkerResult = {
  noNewNodes: boolean
  nodesToAdd: RawNodeType[]
  edgesToAdd: RawEdgeType[]
  nodeSizeUpdates: Array<{ id: string; size: number; degree: number }>
  expandedNodeUpdate: { id: string; size: number; degree: number } | null
}

const calculateScaledNodeSize = (degree: number, minDegree: number, maxDegree: number): number => {
  const safeMaxDegree = Math.max(minDegree, maxDegree)
  const range = safeMaxDegree - minDegree || 1
  const scale = Constants.maxNodeSize - Constants.minNodeSize
  const limitedDegree = Math.min(degree, safeMaxDegree + 1)
  return Math.round(
    Constants.minNodeSize + scale * Math.pow((limitedDegree - minDegree) / range, 0.5)
  )
}

export const buildExpandedGraph = (
  input: GraphExpandWorkerInput
): GraphExpandWorkerResult => {
  const {
    expandedNodeId,
    expandedNodeSize,
    cameraRatio,
    existingNodes,
    existingEdges,
    incomingNodes,
    incomingEdges
  } = input

  const existingNodeIds = new Set(existingNodes.map((node) => node.id))
  const existingNodePositions = new Map(
    existingNodes.map((node) => [node.id, { x: node.x, y: node.y }] as const)
  )
  const existingDegreeMap = new Map(existingNodes.map((node) => [node.id, node.degree] as const))
  const existingEdgeKeys = new Set(
    existingEdges.map((edge) => `${edge.source}::${edge.target}`)
  )
  const nodesById = new Map(incomingNodes.map((node) => [node.id, node] as const))

  const directlyConnectedNodeIds = new Set<string>()
  for (const edge of incomingEdges) {
    if (edge.source === expandedNodeId && !existingNodeIds.has(edge.target)) {
      directlyConnectedNodeIds.add(edge.target)
    }
    if (edge.target === expandedNodeId && !existingNodeIds.has(edge.source)) {
      directlyConnectedNodeIds.add(edge.source)
    }
  }

  const minDegree = 1
  let maxDegree = existingNodes.reduce(
    (currentMax, node) => Math.max(currentMax, node.degree),
    0
  )

  const nodeDegrees = new Map<string, number>()
  const existingNodeDegreeIncrements = new Map<string, number>()
  const nodesWithDiscardedEdges = new Set<string>()
  const edgesToAdd: RawEdgeType[] = []

  for (const edge of incomingEdges) {
    const sourceExists =
      existingNodeIds.has(edge.source) || directlyConnectedNodeIds.has(edge.source)
    const targetExists =
      existingNodeIds.has(edge.target) || directlyConnectedNodeIds.has(edge.target)

    if (sourceExists && targetExists) {
      const forwardKey = `${edge.source}::${edge.target}`
      const reverseKey = `${edge.target}::${edge.source}`
      if (!existingEdgeKeys.has(forwardKey) && !existingEdgeKeys.has(reverseKey)) {
        edgesToAdd.push(edge)
      }

      if (directlyConnectedNodeIds.has(edge.source)) {
        nodeDegrees.set(edge.source, (nodeDegrees.get(edge.source) || 0) + 1)
      } else if (existingNodeIds.has(edge.source)) {
        existingNodeDegreeIncrements.set(
          edge.source,
          (existingNodeDegreeIncrements.get(edge.source) || 0) + 1
        )
      }

      if (directlyConnectedNodeIds.has(edge.target)) {
        nodeDegrees.set(edge.target, (nodeDegrees.get(edge.target) || 0) + 1)
      } else if (existingNodeIds.has(edge.target)) {
        existingNodeDegreeIncrements.set(
          edge.target,
          (existingNodeDegreeIncrements.get(edge.target) || 0) + 1
        )
      }
    } else {
      if (sourceExists) {
        nodesWithDiscardedEdges.add(edge.source)
        if (directlyConnectedNodeIds.has(edge.source)) {
          nodeDegrees.set(edge.source, (nodeDegrees.get(edge.source) || 0) + 1)
        }
      }
      if (targetExists) {
        nodesWithDiscardedEdges.add(edge.target)
        if (directlyConnectedNodeIds.has(edge.target)) {
          nodeDegrees.set(edge.target, (nodeDegrees.get(edge.target) || 0) + 1)
        }
      }
    }
  }

  for (const degree of nodeDegrees.values()) {
    maxDegree = Math.max(maxDegree, degree)
  }
  for (const [nodeId, increment] of existingNodeDegreeIncrements.entries()) {
    maxDegree = Math.max(maxDegree, (existingDegreeMap.get(nodeId) || 0) + increment)
  }

  const expandedNodePosition = existingNodePositions.get(expandedNodeId) ?? { x: 0, y: 0 }
  const sortedNodeIds = Array.from(directlyConnectedNodeIds)
  const spreadFactor =
    Math.max(Math.sqrt(expandedNodeSize) * 4, Math.sqrt(sortedNodeIds.length || 1) * 3) /
    Math.max(cameraRatio, 0.1)
  const randomSeed = Array.from(expandedNodeId).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0
  )
  const randomAngle = (randomSeed % 360) * (Math.PI / 180)

  const nodesToAdd = sortedNodeIds
    .map((nodeId, index) => {
      const node = nodesById.get(nodeId)
      if (!node) {
        return null
      }
      const angle = (2 * Math.PI * index) / Math.max(sortedNodeIds.length, 1)
      const degree = nodeDegrees.get(nodeId) || 0
      return {
        ...node,
        x: expandedNodePosition.x + Math.cos(randomAngle + angle) * spreadFactor,
        y: expandedNodePosition.y + Math.sin(randomAngle + angle) * spreadFactor,
        degree,
        size: calculateScaledNodeSize(degree, minDegree, maxDegree)
      }
    })
    .filter((node): node is RawNodeType => node !== null)

  const nodeSizeUpdates = Array.from(nodesWithDiscardedEdges)
    .map((nodeId) => {
      const degree =
        (existingDegreeMap.get(nodeId) || 0) + (existingNodeDegreeIncrements.get(nodeId) || 0) + 1
      return {
        id: nodeId,
        degree,
        size: calculateScaledNodeSize(degree, minDegree, maxDegree)
      }
    })

  const expandedDegree =
    (existingDegreeMap.get(expandedNodeId) || 0) + (existingNodeDegreeIncrements.get(expandedNodeId) || 0)

  return {
    noNewNodes: nodesToAdd.length === 0,
    nodesToAdd,
    edgesToAdd,
    nodeSizeUpdates,
    expandedNodeUpdate: existingNodeIds.has(expandedNodeId)
      ? {
          id: expandedNodeId,
          degree: expandedDegree,
          size: calculateScaledNodeSize(expandedDegree, minDegree, maxDegree)
        }
      : null
  }
}
