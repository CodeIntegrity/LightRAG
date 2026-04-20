import type {
  GraphMergeSuggestionsRequest,
  GraphMergeSuggestionsResponse,
  GraphWorkbenchQueryRequest
} from '@/api/lightrag'
import type { RawGraph } from '@/stores/graph'
import type { GraphMergeDraft } from '@/stores/graphWorkbench'
import type { ActionInspectorSelection } from '@/components/graph/ActionInspector'

export type PostMergeFollowUpAction = 'focus_target' | 'refresh_results' | 'continue_review'

export type PostMergeFollowUpOutcome = {
  focusTarget: string | null
  shouldRefresh: boolean
  dismissActions: boolean
}

export type MergeEntityNavigationField = 'source' | 'target'

export type MergeEntityNavigationPlan = {
  entityName: string
  nodeId: string | null
  requiresQueryRefresh: boolean
}

export type MergeSuggestionTranslator = (key: string, options?: Record<string, unknown>) => string

export const DEFAULT_SUGGESTION_LIMIT = 20
export const DEFAULT_SUGGESTION_MIN_SCORE = 0.6
export const MERGE_FOLLOW_UP_AUTO_DISMISS_MS = 8000

const normalizeEntityName = (value: string): string => value.trim()

const dedupeEntities = (values: string[]): string[] => {
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeEntityName(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
  }
  return deduped
}

const parseEntityListInput = (input: string): string[] => {
  const raw = input
    .split(/[,\n]/g)
    .map((part) => normalizeEntityName(part))
    .filter((part) => part.length > 0)
  return dedupeEntities(raw)
}

export const buildManualMergeDraftFromInput = (
  sourceEntitiesInput: string,
  targetEntityInput: string
): GraphMergeDraft => {
  const targetEntity = normalizeEntityName(targetEntityInput)
  const targetKey = targetEntity.toLowerCase()
  const sourceEntities = parseEntityListInput(sourceEntitiesInput).filter(
    (entity) => entity.toLowerCase() !== targetKey
  )
  return {
    sourceEntities,
    targetEntity
  }
}

export const resolveMergeEntityNavigationValue = (
  sourceEntitiesInput: string,
  targetEntityInput: string,
  field: MergeEntityNavigationField
): string => {
  const draft = buildManualMergeDraftFromInput(sourceEntitiesInput, targetEntityInput)
  if (field === 'source') {
    return draft.sourceEntities[0] ?? ''
  }
  return draft.targetEntity
}

const resolveGraphNodeIdForEntity = (
  rawGraph: Pick<RawGraph, 'getNode' | 'nodes'> | null | undefined,
  entityName: string
): string | null => {
  const normalizedEntityName = normalizeEntityName(entityName)
  if (!normalizedEntityName || !rawGraph) {
    return null
  }

  const directNode = rawGraph.getNode(normalizedEntityName)
  if (directNode) {
    return directNode.id
  }

  const matchedNode = rawGraph.nodes.find((node) => {
    const entityId = String(node.properties?.entity_id ?? '').trim()
    const name = String(node.properties?.name ?? '').trim()
    return entityId === normalizedEntityName || name === normalizedEntityName
  })

  return matchedNode?.id ?? null
}

export const createMergeEntityNavigationPlan = (
  rawGraph: Pick<RawGraph, 'getNode' | 'nodes'> | null | undefined,
  entityName: string
): MergeEntityNavigationPlan | null => {
  const normalizedEntityName = normalizeEntityName(entityName)
  if (!normalizedEntityName) {
    return null
  }

  const nodeId = resolveGraphNodeIdForEntity(rawGraph, normalizedEntityName)
  return {
    entityName: normalizedEntityName,
    nodeId,
    requiresQueryRefresh: nodeId === null
  }
}

export const buildMergeSuggestionsRequest = (
  appliedQuery: GraphWorkbenchQueryRequest | null,
  filterDraft: GraphWorkbenchQueryRequest,
  limit: number = DEFAULT_SUGGESTION_LIMIT,
  minScore: number = DEFAULT_SUGGESTION_MIN_SCORE,
  useLlm: boolean = false
): GraphMergeSuggestionsRequest => {
  const scope = appliedQuery?.scope ?? filterDraft.scope
  return {
    scope: {
      label: scope.label,
      max_depth: scope.max_depth,
      max_nodes: scope.max_nodes,
      only_matched_neighborhood: scope.only_matched_neighborhood
    },
    limit,
    min_score: minScore,
    use_llm: useLlm
  }
}

export const resolveMergeSuggestionFallbackNotice = (
  meta: GraphMergeSuggestionsResponse['meta'] | null | undefined,
  t?: MergeSuggestionTranslator
): string | null => {
  if (!meta?.llm_requested || meta.llm_used) {
    return null
  }

  const reason = meta.llm_fallback_reason?.trim()
  if (t) {
    return reason
      ? t('graphPanel.workbench.merge.messages.llmFallback', { reason })
      : t('graphPanel.workbench.merge.messages.llmFallbackGeneric')
  }

  return reason
    ? `LLM reranking unavailable. Fell back to heuristic suggestions: ${reason}`
    : 'LLM reranking unavailable. Fell back to heuristic suggestions.'
}

export const buildMergeDraftFromSelection = (
  selection: ActionInspectorSelection | null | undefined
): GraphMergeDraft => {
  if (!selection) {
    return {
      sourceEntities: [],
      targetEntity: ''
    }
  }

  if (selection.kind === 'node') {
    const targetEntity = String(selection.node.properties?.entity_id ?? selection.node.id ?? '')
    return {
      sourceEntities: [],
      targetEntity
    }
  }

  const source = String(selection.edge.sourceNode?.properties?.entity_id ?? selection.edge.source ?? '')
  const target = String(selection.edge.targetNode?.properties?.entity_id ?? selection.edge.target ?? '')
  return {
    sourceEntities: source ? [source] : [],
    targetEntity: target
  }
}

const buildVisibleRevisionTokenMap = (
  selection: ActionInspectorSelection | null | undefined
): Record<string, string> => {
  if (!selection) {
    return {}
  }

  if (selection.kind === 'node') {
    const entityId = String(selection.node.properties?.entity_id ?? selection.node.id ?? '')
    const revisionToken = selection.node.revision_token
    return entityId && revisionToken ? { [entityId]: revisionToken } : {}
  }

  const tokens: Record<string, string> = {}
  const sourceEntity = String(
    selection.edge.sourceNode?.properties?.entity_id ?? selection.edge.source ?? ''
  )
  const targetEntity = String(
    selection.edge.targetNode?.properties?.entity_id ?? selection.edge.target ?? ''
  )
  const edgeToken = selection.edge.revision_token

  if (sourceEntity && edgeToken) {
    tokens[sourceEntity] = edgeToken
  }
  if (targetEntity && edgeToken) {
    tokens[targetEntity] = edgeToken
  }
  return tokens
}

export const buildExpectedRevisionTokensForMerge = (
  draft: GraphMergeDraft,
  selection: ActionInspectorSelection | null | undefined
): Record<string, string> | undefined => {
  const visibleTokens = buildVisibleRevisionTokenMap(selection)
  const mergedTokens: Record<string, string> = {}

  for (const entity of [...draft.sourceEntities, draft.targetEntity]) {
    const normalized = normalizeEntityName(entity)
    const token = visibleTokens[normalized]
    if (normalized && token) {
      mergedTokens[normalized] = token
    }
  }

  return Object.keys(mergedTokens).length > 0 ? mergedTokens : undefined
}

export const resolvePostMergeFollowUp = (
  action: PostMergeFollowUpAction,
  targetEntity: string
): PostMergeFollowUpOutcome => {
  if (action === 'focus_target') {
    return {
      focusTarget: targetEntity,
      shouldRefresh: false,
      dismissActions: true
    }
  }

  if (action === 'refresh_results') {
    return {
      focusTarget: null,
      shouldRefresh: true,
      dismissActions: true
    }
  }

  return {
    focusTarget: null,
    shouldRefresh: false,
    dismissActions: true
  }
}

export const shouldAutoDismissMergeFollowUp = (
  mergeFollowUp: { mergedAt: number } | null | undefined,
  now: number = Date.now()
): boolean => {
  if (!mergeFollowUp) {
    return false
  }

  return now - mergeFollowUp.mergedAt >= MERGE_FOLLOW_UP_AUTO_DISMISS_MS
}
