import type MiniSearch from 'minisearch'
import { createMergeEntityNavigationPlan } from '@/utils/mergeEntity'

type SearchableGraph = {
  hasNode: (id: string) => boolean
  nodes: () => string[]
  getNodeAttribute: (id: string, attribute: string) => unknown
}

type SearchResultLike = {
  id: string
}

type SearchableRawGraph = {
  getNode: (nodeId: string) => { id: string } | undefined
  nodes: Array<{
    id: string
    properties?: Record<string, unknown>
  }>
}

export const graphSearchMessageId = '__message_item'

export type GraphSearchOptionItem = {
  value: string
  id: string
  type: 'nodes' | 'labels' | 'message'
  label?: string
  message?: string
}

type LocalGraphSearchConfig = {
  initialLimit: number
  maxContainsScanNodes?: number
  minContainsQueryLength?: number
  enoughExactMatches?: number
}

export type GraphSearchSelectionAction =
  | {
      kind: 'select-node'
      nodeId: string
    }
  | {
      kind: 'query-label'
      label: string
      forceRefresh: boolean
    }
  | {
      kind: 'noop'
    }

const createNodeOption = (
  nodeId: string,
  label?: string
): GraphSearchOptionItem => ({
  value: `node:${nodeId}`,
  id: nodeId,
  type: 'nodes',
  label
})

const createLabelOption = (label: string): GraphSearchOptionItem => ({
  value: `label:${label}`,
  id: label,
  type: 'labels',
  label
})

export const createMessageOption = (message: string): GraphSearchOptionItem => ({
  value: graphSearchMessageId,
  id: graphSearchMessageId,
  type: 'message',
  message
})

const defaultLocalGraphSearchConfig = {
  maxContainsScanNodes: Number.POSITIVE_INFINITY,
  minContainsQueryLength: 2,
  enoughExactMatches: 5
} as const

export const searchLocalGraphNodes = (
  graph: SearchableGraph | null,
  searchEngine: MiniSearch<{ id: string; label: string }> | null,
  query: string,
  configOrLimit: number | LocalGraphSearchConfig
): GraphSearchOptionItem[] => {
  const {
    initialLimit,
    maxContainsScanNodes,
    minContainsQueryLength,
    enoughExactMatches
  } = typeof configOrLimit === 'number'
    ? { initialLimit: configOrLimit, ...defaultLocalGraphSearchConfig }
    : { ...defaultLocalGraphSearchConfig, ...configOrLimit }

  if (!graph || !searchEngine || graph.nodes().length === 0) {
    return []
  }

  if (!query) {
    return graph
      .nodes()
      .filter((id) => graph.hasNode(id))
      .slice(0, initialLimit)
      .map((id) => createNodeOption(id, String(graph.getNodeAttribute(id, 'label') || id)))
  }

  const matchedResults = searchEngine
    .search(query)
    .filter((result: SearchResultLike) => graph.hasNode(result.id))
    .map((result: SearchResultLike) =>
      createNodeOption(
        result.id,
        String(graph.getNodeAttribute(result.id, 'label') || result.id)
      )
    )

  if (
    matchedResults.length >= enoughExactMatches ||
    query.length < minContainsQueryLength ||
    graph.nodes().length > maxContainsScanNodes
  ) {
    return matchedResults
  }

  const matchedIds = new Set(matchedResults.map((item) => item.id))
  const queryLower = query.toLowerCase()
  const middleMatchedResults = graph
    .nodes()
    .filter((id) => {
      if (matchedIds.has(id) || !graph.hasNode(id)) {
        return false
      }

      const label = graph.getNodeAttribute(id, 'label')
      if (typeof label !== 'string') {
        return false
      }

      const labelLower = label.toLowerCase()
      return !labelLower.startsWith(queryLower) && labelLower.includes(queryLower)
    })
    .map((id) => createNodeOption(id, String(graph.getNodeAttribute(id, 'label') || id)))

  return [...matchedResults, ...middleMatchedResults]
}

export const shouldFetchRemoteGraphLabels = (
  query: string,
  localOptionCount: number,
  localLimit: number,
  minQueryLength: number = 2
): boolean => {
  return query.length >= minQueryLength && localOptionCount < localLimit
}

export const buildGraphSearchIndexKey = (
  rawGraph: SearchableRawGraph | null,
  maxIndexedNodes: number
): string => {
  if (!rawGraph) {
    return 'empty'
  }

  let hash = 0
  const indexedNodes = rawGraph.nodes.slice(0, maxIndexedNodes)
  for (const node of indexedNodes) {
    const entityId = String(node.properties?.entity_id ?? '')
    const name = String(node.properties?.name ?? '')
    const signature = `${node.id}:${entityId}:${name}`
    for (let index = 0; index < signature.length; index += 1) {
      hash = (hash * 31 + signature.charCodeAt(index)) >>> 0
    }
  }

  return `${rawGraph.nodes.length}:${indexedNodes.length}:${hash}`
}

export const mapRemoteLabelsToOptions = (
  labels: string[],
  rawGraph: SearchableRawGraph | null
): GraphSearchOptionItem[] => {
  return labels
    .map((label) => {
      const plan = createMergeEntityNavigationPlan(rawGraph, label)
      return plan?.nodeId ? createNodeOption(plan.nodeId, plan.entityName) : createLabelOption(label)
    })
}

export const mergeGraphSearchOptions = (
  primary: GraphSearchOptionItem[],
  secondary: GraphSearchOptionItem[]
): GraphSearchOptionItem[] => {
  const merged: GraphSearchOptionItem[] = []
  const seenValues = new Set<string>()

  for (const item of [...primary, ...secondary]) {
    if (seenValues.has(item.value)) {
      continue
    }
    seenValues.add(item.value)
    merged.push(item)
  }

  return merged
}

export const limitGraphSearchOptions = (
  options: GraphSearchOptionItem[],
  limit: number,
  overflowMessage: string
): GraphSearchOptionItem[] => {
  if (options.length <= limit) {
    return options
  }

  return [
    ...options.slice(0, limit),
    createMessageOption(overflowMessage)
  ]
}

export const resolveGraphSearchSelection = (
  item: GraphSearchOptionItem | undefined,
  currentQueryLabel: string
): GraphSearchSelectionAction => {
  if (!item || item.type === 'message') {
    return { kind: 'noop' }
  }

  if (item.type === 'nodes') {
    return {
      kind: 'select-node',
      nodeId: item.id
    }
  }

  return {
    kind: 'query-label',
    label: item.id,
    forceRefresh: item.id === currentQueryLabel
  }
}
