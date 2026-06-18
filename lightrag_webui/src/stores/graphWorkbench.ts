import { create } from 'zustand'

import type {
  GraphMergeSuggestionCandidate,
  GraphWorkbenchQueryRequest
} from '@/api/lightrag'
import { createSelectors } from '@/lib/utils'
import { useSettingsStore } from './settings'

export type GraphMergeDraft = {
  sourceEntities: string[]
  targetEntity: string
}

export type GraphMergeFollowUpState = {
  targetEntity: string
  sourceEntities: string[]
  mergedAt: number
}

export type GraphWorkbenchMutationError = {
  message: string
  isConflict: boolean
}

export type GraphWorkbenchActionMode = 'inspect' | 'create' | 'delete' | 'merge'

export type GraphWorkbenchFilterSection =
  | 'scope'
  | 'node'
  | 'edge'
  | 'source'
  | 'view'

export type GraphWorkbenchFilterSectionState = Record<GraphWorkbenchFilterSection, boolean>

const isRevisionConflictMessage = (message: string): boolean => {
  const normalized = message.toLowerCase()
  return normalized.includes('revision token') || normalized.includes('stale')
}

const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }
  }

  if (error instanceof Error) {
    const detailMatch = error.message.match(/"detail"\s*:\s*"([^"]+)"/)
    if (detailMatch?.[1]) {
      return detailMatch[1]
    }
    return error.message
  }

  return fallback
}

export const normalizeWorkbenchMutationError = (
  error: unknown,
  fallbackMessage: string
): GraphWorkbenchMutationError => {
  const message = extractErrorMessage(error, fallbackMessage)
  const isConflict =
    (error &&
      typeof error === 'object' &&
      (error as { response?: { status?: number } }).response?.status === 409) ||
    (message.includes('409') && isRevisionConflictMessage(message)) ||
    isRevisionConflictMessage(message)

  if (isConflict) {
    return {
      message: `Stale revision conflict: ${message}. Please refresh and retry.`,
      isConflict: true
    }
  }

  return {
    message,
    isConflict: false
  }
}

export const cloneQuery = (query: GraphWorkbenchQueryRequest): GraphWorkbenchQueryRequest => {
  return {
    scope: { ...query.scope },
    node_filters: {
      ...query.node_filters,
      entity_types: [...query.node_filters.entity_types]
    },
    edge_filters: {
      ...query.edge_filters,
      relation_types: [...query.edge_filters.relation_types],
      source_entity_types: [...query.edge_filters.source_entity_types],
      target_entity_types: [...query.edge_filters.target_entity_types]
    },
    source_filters: {
      ...query.source_filters,
      file_paths: [...query.source_filters.file_paths]
    },
    view_options: { ...query.view_options }
  }
}

const getCurrentGraphMaxNodes = (): number => {
  const settings = useSettingsStore.getState()
  return settings.backendMaxGraphNodes ?? settings.graphMaxNodes
}

const queryWithMaxNodes = (
  query: GraphWorkbenchQueryRequest,
  maxNodes: number
): GraphWorkbenchQueryRequest => ({
  ...cloneQuery(query),
  scope: {
    ...query.scope,
    max_nodes: maxNodes
  }
})

export const getDefaultGraphWorkbenchFilterDraft = (
  maxNodes = getCurrentGraphMaxNodes()
): GraphWorkbenchQueryRequest => ({
  scope: {
    label: '*',
    max_depth: 3,
    max_nodes: maxNodes,
    direction: 'both',
    only_matched_neighborhood: false
  },
  node_filters: {
    entity_types: [],
    name_query: '',
    description_query: '',
    degree_min: null,
    degree_max: null,
    isolated_only: false
  },
  edge_filters: {
    relation_types: [],
    keyword_query: '',
    weight_min: null,
    weight_max: null,
    source_entity_types: [],
    target_entity_types: []
  },
  source_filters: {
    source_id_query: '',
    file_paths: [],
    time_from: null,
    time_to: null
  },
  view_options: {
    show_nodes_only: false,
    show_edges_only: false,
    hide_low_weight_edges: false,
    hide_empty_description: false
  }
})

export const getDefaultMergeDraft = (): GraphMergeDraft => ({
  sourceEntities: [],
  targetEntity: ''
})

interface GraphWorkbenchState {
  filterDraft: GraphWorkbenchQueryRequest
  appliedQuery: GraphWorkbenchQueryRequest | null
  mergeCandidates: GraphMergeSuggestionCandidate[]
  selectedMergeCandidateTargets: string[]
  mergeDraft: GraphMergeDraft
  mergeFollowUp: GraphMergeFollowUpState | null
  mutationError: string | null
  conflictError: string | null
  queryVersion: number
  activeActionMode: GraphWorkbenchActionMode
  filterSections: GraphWorkbenchFilterSectionState

  setFilterDraft: (draft: GraphWorkbenchQueryRequest) => void
  applyFilterDraft: () => void
  applyScopeLabel: (label: string) => void
  setActiveActionMode: (mode: GraphWorkbenchActionMode) => void
  toggleFilterSection: (section: GraphWorkbenchFilterSection) => void
  setMergeCandidates: (candidates: GraphMergeSuggestionCandidate[]) => void
  selectMergeCandidate: (targetEntity: string) => void
  setMergeDraft: (draft: GraphMergeDraft) => void
  importMergeCandidate: (candidate: GraphMergeSuggestionCandidate) => void
  clearMergeDraft: () => void
  clearSelection: () => void
  setMergeFollowUp: (targetEntity: string, sourceEntities: string[]) => void
  clearMergeFollowUp: () => void
  setMutationError: (message: string | null, isConflict?: boolean) => void
  clearMutationError: () => void
  requestRefresh: () => void
  syncDefaultMaxNodes: (maxNodes: number, previousMaxNodes: number) => void
  reset: () => void
}

const useGraphWorkbenchStoreBase = create<GraphWorkbenchState>()((set, get) => ({
  filterDraft: getDefaultGraphWorkbenchFilterDraft(),
  appliedQuery: null,
  mergeCandidates: [],
  selectedMergeCandidateTargets: [],
  mergeDraft: getDefaultMergeDraft(),
  mergeFollowUp: null,
  mutationError: null,
  conflictError: null,
  queryVersion: 0,
  activeActionMode: 'inspect',
  filterSections: {
    scope: true,
    node: false,
    edge: false,
    source: false,
    view: false
  },

  setFilterDraft: (draft) => set({ filterDraft: cloneQuery(draft) }),
  applyFilterDraft: () => {
    const draft = get().filterDraft
    set((state) => ({
      appliedQuery: cloneQuery(draft),
      queryVersion: state.queryVersion + 1
    }))
  },
  applyScopeLabel: (label) =>
    set((state) => {
      const nextDraft = cloneQuery(state.appliedQuery ?? state.filterDraft)
      nextDraft.scope.label = label
      return {
        filterDraft: cloneQuery(nextDraft),
        appliedQuery: nextDraft,
        queryVersion: state.queryVersion + 1
      }
    }),
  setActiveActionMode: (mode) => set({ activeActionMode: mode }),
  toggleFilterSection: (section) =>
    set((state) => ({
      filterSections: {
        ...state.filterSections,
        [section]: !state.filterSections[section]
      }
    })),
  setMergeCandidates: (candidates) => set({ mergeCandidates: [...candidates] }),
  selectMergeCandidate: (targetEntity) =>
    set((state) => {
      if (state.selectedMergeCandidateTargets.includes(targetEntity)) {
        return {
          selectedMergeCandidateTargets: state.selectedMergeCandidateTargets.filter(
            (item) => item !== targetEntity
          )
        }
      }
      return {
        selectedMergeCandidateTargets: [
          ...state.selectedMergeCandidateTargets,
          targetEntity
        ]
      }
    }),
  setMergeDraft: (draft) =>
    set({
      mergeDraft: {
        sourceEntities: [...draft.sourceEntities],
        targetEntity: draft.targetEntity
      }
    }),
  importMergeCandidate: (candidate) =>
    set({
      mergeDraft: {
        sourceEntities: [...candidate.source_entities],
        targetEntity: candidate.target_entity
      },
      selectedMergeCandidateTargets: [candidate.target_entity]
    }),
  clearMergeDraft: () => set({ mergeDraft: getDefaultMergeDraft() }),
  clearSelection: () => set({ selectedMergeCandidateTargets: [] }),
  setMergeFollowUp: (targetEntity, sourceEntities) =>
    set({
      mergeFollowUp: {
        targetEntity,
        sourceEntities: [...sourceEntities],
        mergedAt: Date.now()
      }
    }),
  clearMergeFollowUp: () => set({ mergeFollowUp: null }),
  setMutationError: (message, isConflict = false) =>
    set({
      mutationError: message,
      conflictError: isConflict ? message : null
    }),
  clearMutationError: () => set({ mutationError: null, conflictError: null }),
  requestRefresh: () => set((state) => ({ queryVersion: state.queryVersion + 1 })),
  syncDefaultMaxNodes: (maxNodes, previousMaxNodes) =>
    set((state) => {
      // 值未变化时直接 no-op：避免重建对象引用。否则订阅 appliedQuery 的 useLightragGraph
      // 会把“同值新引用”误判为依赖变化，导致健康检查每 15 秒重载整图
      if (maxNodes === previousMaxNodes) {
        return {}
      }

      const shouldUpdateDraft = state.filterDraft.scope.max_nodes === previousMaxNodes
      const shouldUpdateApplied = state.appliedQuery?.scope.max_nodes === previousMaxNodes

      if (!shouldUpdateDraft && !shouldUpdateApplied) {
        return {}
      }

      return {
        filterDraft: shouldUpdateDraft
          ? queryWithMaxNodes(state.filterDraft, maxNodes)
          : state.filterDraft,
        appliedQuery:
          state.appliedQuery && shouldUpdateApplied
            ? queryWithMaxNodes(state.appliedQuery, maxNodes)
            : state.appliedQuery
      }
    }),
  reset: () =>
    set({
      filterDraft: getDefaultGraphWorkbenchFilterDraft(),
      appliedQuery: null,
      mergeCandidates: [],
      selectedMergeCandidateTargets: [],
      mergeDraft: getDefaultMergeDraft(),
      mergeFollowUp: null,
      mutationError: null,
      conflictError: null,
      queryVersion: 0,
      activeActionMode: 'inspect',
      filterSections: {
        scope: true,
        node: false,
        edge: false,
        source: false,
        view: false
      }
    })
}))

const useGraphWorkbenchStore = createSelectors(useGraphWorkbenchStoreBase)

export { useGraphWorkbenchStore }
