import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createSelectors } from '@/lib/utils'
import { defaultQueryLabel } from '@/lib/constants'
import { Message, PromptConfigGroup, QueryPromptOverrides, QueryRequest } from '@/api/lightrag'
import { DEFAULT_LAYOUT_PARAMS } from '@/utils/graphViewPersistence'

type Theme = 'dark' | 'light' | 'system'
type Language = 'en' | 'zh' | 'fr' | 'ar' | 'zh_TW' | 'ru' | 'ja' | 'de' | 'uk' | 'ko' | 'vi'
type Tab = 'documents' | 'knowledge-graph' | 'prompt-management' | 'retrieval' | 'api'

interface SettingsState {
  currentWorkspace: string
  setCurrentWorkspace: (workspace: string) => void
  workspaceDisplayNames: Record<string, string>
  setWorkspaceDisplayNames: (displayNames: Record<string, string>) => void
  clearWorkspaceDisplayNames: () => void

  // Document manager settings
  showFileName: boolean
  setShowFileName: (show: boolean) => void

  documentsPageSize: number
  setDocumentsPageSize: (size: number) => void

  // User prompt history
  userPromptHistory: string[]
  addUserPromptToHistory: (prompt: string) => void
  setUserPromptHistory: (history: string[]) => void

  // Graph viewer settings
  showPropertyPanel: boolean
  showNodeSearchBar: boolean
  showLegend: boolean
  setShowLegend: (show: boolean) => void

  showNodeLabel: boolean
  graphLabelFontSize: number
  enableNodeDrag: boolean
  enableSearchLinkedDrag: boolean

  showEdgeLabel: boolean
  showDirectionalArrows: boolean
  enableHideUnselectedEdges: boolean
  enableEdgeEvents: boolean

  minEdgeSize: number
  setMinEdgeSize: (size: number) => void

  maxEdgeSize: number
  setMaxEdgeSize: (size: number) => void

  graphQueryMaxDepth: number
  setGraphQueryMaxDepth: (depth: number) => void

  graphMaxNodes: number
  setGraphMaxNodes: (nodes: number, triggerRefresh?: boolean) => void

  backendMaxGraphNodes: number | null
  setBackendMaxGraphNodes: (maxNodes: number | null) => void

  graphLayoutMaxIterations: number
  setGraphLayoutMaxIterations: (iterations: number) => void

  graphLayoutRepulsion: number
  setGraphLayoutRepulsion: (repulsion: number) => void

  graphLayoutGravity: number
  setGraphLayoutGravity: (gravity: number) => void

  graphLayoutMargin: number
  setGraphLayoutMargin: (margin: number) => void

  graphLayoutAttraction: number
  setGraphLayoutAttraction: (attraction: number) => void

  graphLayoutInertia: number
  setGraphLayoutInertia: (inertia: number) => void

  graphLayoutMaxMove: number
  setGraphLayoutMaxMove: (maxMove: number) => void

  graphLayoutExpansion: number
  setGraphLayoutExpansion: (expansion: number) => void

  graphLayoutGridSize: number
  setGraphLayoutGridSize: (gridSize: number) => void

  graphLayoutRatio: number
  setGraphLayoutRatio: (ratio: number) => void

  graphLayoutSpeed: number
  setGraphLayoutSpeed: (speed: number) => void

  // Retrieval settings
  queryLabel: string
  setQueryLabel: (queryLabel: string) => void

  retrievalHistory: Message[]
  setRetrievalHistory: (history: Message[]) => void

  querySettings: Omit<QueryRequest, 'query'>
  updateQuerySettings: (settings: Partial<QueryRequest>) => void
  promptManagementGroup: PromptConfigGroup
  setPromptManagementGroup: (group: PromptConfigGroup) => void
  promptManagementSelectedVersionId: string | null
  setPromptManagementSelectedVersionId: (versionId: string | null) => void
  retrievalPromptVersionSelection: string
  setRetrievalPromptVersionSelection: (selection: string) => void
  retrievalPromptDraft: QueryPromptOverrides | undefined
  setRetrievalPromptDraft: (draft: QueryPromptOverrides | undefined) => void

  // Auth settings
  apiKey: string | null
  setApiKey: (key: string | null) => void

  // App settings
  theme: Theme
  setTheme: (theme: Theme) => void

  language: Language
  setLanguage: (lang: Language) => void

  enableHealthCheck: boolean
  setEnableHealthCheck: (enable: boolean) => void

  currentTab: Tab
  setCurrentTab: (tab: Tab) => void

  // Search label dropdown refresh trigger (non-persistent, runtime only)
  searchLabelDropdownRefreshTrigger: number
  triggerSearchLabelDropdownRefresh: () => void
}

const useSettingsStoreBase = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      language: 'en',
      showPropertyPanel: true,
      showNodeSearchBar: true,
      showLegend: false,

      showNodeLabel: true,
      graphLabelFontSize: 12,
      enableNodeDrag: true,
      enableSearchLinkedDrag: false,

      showEdgeLabel: false,
      showDirectionalArrows: false,
      enableHideUnselectedEdges: true,
      enableEdgeEvents: false,

      minEdgeSize: 1,
      maxEdgeSize: 1,

      graphQueryMaxDepth: 3,
      graphMaxNodes: 10000,
      backendMaxGraphNodes: null,
      graphLayoutMaxIterations: DEFAULT_LAYOUT_PARAMS.maxIterations,
      graphLayoutRepulsion: DEFAULT_LAYOUT_PARAMS.repulsion,
      graphLayoutGravity: DEFAULT_LAYOUT_PARAMS.gravity,
      graphLayoutMargin: DEFAULT_LAYOUT_PARAMS.margin,
      graphLayoutAttraction: DEFAULT_LAYOUT_PARAMS.attraction,
      graphLayoutInertia: DEFAULT_LAYOUT_PARAMS.inertia,
      graphLayoutMaxMove: DEFAULT_LAYOUT_PARAMS.maxMove,
      graphLayoutExpansion: DEFAULT_LAYOUT_PARAMS.expansion,
      graphLayoutGridSize: DEFAULT_LAYOUT_PARAMS.gridSize,
      graphLayoutRatio: DEFAULT_LAYOUT_PARAMS.ratio,
      graphLayoutSpeed: DEFAULT_LAYOUT_PARAMS.speed,

      queryLabel: defaultQueryLabel,

      enableHealthCheck: true,

      apiKey: null,
      currentWorkspace: '',
      workspaceDisplayNames: {},

      currentTab: 'documents',
      showFileName: false,
      documentsPageSize: 10,

      retrievalHistory: [],
      userPromptHistory: [],
      promptManagementGroup: 'retrieval',
      promptManagementSelectedVersionId: null,
      retrievalPromptVersionSelection: 'active',
      retrievalPromptDraft: undefined,

      querySettings: {
        mode: 'mix',
        top_k: 40,
        chunk_top_k: 20,
        max_entity_tokens: 6000,
        max_relation_tokens: 8000,
        max_total_tokens: 30000,
        only_need_context: false,
        only_need_prompt: false,
        stream: true,
        history_turns: 0,
        user_prompt: '',
        prompt_overrides: undefined,
        enable_rerank: true,
        include_references: true,
        include_chunk_content: false
      },

      setTheme: (theme: Theme) => set({ theme }),

      setLanguage: (language: Language) => {
        set({ language })
      },

      setGraphLayoutMaxIterations: (iterations: number) =>
        set({
          graphLayoutMaxIterations: iterations
        }),

      setGraphLayoutRepulsion: (repulsion: number) =>
        set({
          graphLayoutRepulsion: repulsion
        }),

      setGraphLayoutGravity: (gravity: number) =>
        set({
          graphLayoutGravity: gravity
        }),

      setGraphLayoutMargin: (margin: number) =>
        set({
          graphLayoutMargin: margin
        }),

      setGraphLayoutAttraction: (attraction: number) =>
        set({
          graphLayoutAttraction: attraction
        }),

      setGraphLayoutInertia: (inertia: number) =>
        set({
          graphLayoutInertia: inertia
        }),

      setGraphLayoutMaxMove: (maxMove: number) =>
        set({
          graphLayoutMaxMove: maxMove
        }),

      setGraphLayoutExpansion: (expansion: number) =>
        set({
          graphLayoutExpansion: expansion
        }),

      setGraphLayoutGridSize: (gridSize: number) =>
        set({
          graphLayoutGridSize: gridSize
        }),

      setGraphLayoutRatio: (ratio: number) =>
        set({
          graphLayoutRatio: ratio
        }),

      setGraphLayoutSpeed: (speed: number) =>
        set({
          graphLayoutSpeed: speed
        }),

      setQueryLabel: (queryLabel: string) =>
        set({
          queryLabel
        }),

      setGraphQueryMaxDepth: (depth: number) => set({ graphQueryMaxDepth: depth }),

      setGraphMaxNodes: (nodes: number, triggerRefresh: boolean = false) => {
        const state = useSettingsStore.getState()
        if (state.graphMaxNodes === nodes) {
          return
        }

        if (triggerRefresh) {
          const currentLabel = state.queryLabel
          // Atomically update both the node count and the query label to trigger a refresh.
          set({ graphMaxNodes: nodes, queryLabel: '' })

          // Restore the label after a short delay.
          setTimeout(() => {
            set({ queryLabel: currentLabel })
          }, 300)
        } else {
          set({ graphMaxNodes: nodes })
        }
      },

      setBackendMaxGraphNodes: (maxNodes: number | null) => set({ backendMaxGraphNodes: maxNodes }),

      setMinEdgeSize: (size: number) => set({ minEdgeSize: size }),

      setMaxEdgeSize: (size: number) => set({ maxEdgeSize: size }),

      setEnableHealthCheck: (enable: boolean) => set({ enableHealthCheck: enable }),

      setApiKey: (apiKey: string | null) => set({ apiKey }),

      setCurrentWorkspace: (currentWorkspace: string) =>
        set({
          currentWorkspace,
          promptManagementSelectedVersionId: null,
          retrievalPromptVersionSelection: 'active',
          retrievalPromptDraft: undefined
        }),
      setWorkspaceDisplayNames: (workspaceDisplayNames: Record<string, string>) =>
        set({
          workspaceDisplayNames
        }),
      clearWorkspaceDisplayNames: () =>
        set({
          workspaceDisplayNames: {}
        }),

      setCurrentTab: (tab: Tab) => set({ currentTab: tab }),

      setRetrievalHistory: (history: Message[]) => set({ retrievalHistory: history }),

      updateQuerySettings: (settings: Partial<QueryRequest>) => {
        set((state) => ({
          querySettings: { ...state.querySettings, ...settings }
        }))
      },

      setPromptManagementGroup: (promptManagementGroup: PromptConfigGroup) =>
        set({ promptManagementGroup }),

      setPromptManagementSelectedVersionId: (promptManagementSelectedVersionId: string | null) =>
        set({ promptManagementSelectedVersionId }),

      setRetrievalPromptVersionSelection: (retrievalPromptVersionSelection: string) =>
        set({ retrievalPromptVersionSelection }),

      setRetrievalPromptDraft: (retrievalPromptDraft: QueryPromptOverrides | undefined) =>
        set({ retrievalPromptDraft }),

      setShowFileName: (show: boolean) => set({ showFileName: show }),
      setShowLegend: (show: boolean) => set({ showLegend: show }),
      setDocumentsPageSize: (size: number) => set({ documentsPageSize: size }),

      // User prompt history methods
      addUserPromptToHistory: (prompt: string) => {
        if (!prompt.trim()) return

        set((state) => {
          const newHistory = [...state.userPromptHistory]

          // Remove existing occurrence if found
          const existingIndex = newHistory.indexOf(prompt)
          if (existingIndex !== -1) {
            newHistory.splice(existingIndex, 1)
          }

          // Add to beginning
          newHistory.unshift(prompt)

          // Keep only last 12 items
          if (newHistory.length > 12) {
            newHistory.splice(12)
          }

          return { userPromptHistory: newHistory }
        })
      },

      setUserPromptHistory: (history: string[]) => set({ userPromptHistory: history }),

      // Search label dropdown refresh trigger (not persisted)
      searchLabelDropdownRefreshTrigger: 0,
      triggerSearchLabelDropdownRefresh: () =>
        set((state) => ({
          searchLabelDropdownRefreshTrigger: state.searchLabelDropdownRefreshTrigger + 1
        }))
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
      version: 30,
      migrate: (state: any, version: number) => {
        if (version < 2) {
          state.showEdgeLabel = false
        }
        if (version < 3) {
          state.queryLabel = defaultQueryLabel
        }
        if (version < 4) {
          state.showPropertyPanel = true
          state.showNodeSearchBar = true
          state.showNodeLabel = true
          state.enableHealthCheck = true
          state.apiKey = null
        }
        if (version < 5) {
          state.currentTab = 'documents'
        }
        if (version < 6) {
          state.querySettings = {
            mode: 'mix',
            response_type: 'Multiple Paragraphs',
            top_k: 10,
            max_token_for_text_unit: 4000,
            max_token_for_global_context: 4000,
            max_token_for_local_context: 4000,
            only_need_context: false,
            only_need_prompt: false,
            stream: true,
            history_turns: 0,
            hl_keywords: [],
            ll_keywords: []
          }
          state.retrievalHistory = []
        }
        if (version < 7) {
          state.graphQueryMaxDepth = 3
          state.graphLayoutMaxIterations = 15
        }
        if (version < 8) {
          state.graphMinDegree = 0
          state.language = 'en'
        }
        if (version < 9) {
          state.showFileName = false
        }
        if (version < 10) {
          delete state.graphMinDegree // 删除废弃参数
          state.graphMaxNodes = 10000 // 添加新参数
        }
        if (version < 11) {
          state.minEdgeSize = 1
          state.maxEdgeSize = 1
        }
        if (version < 12) {
          // Clear retrieval history to avoid compatibility issues with MessageWithError type
          state.retrievalHistory = []
        }
        if (version < 13) {
          // Add user_prompt field for older versions
          if (state.querySettings) {
            state.querySettings.user_prompt = ''
          }
        }
        if (version < 14) {
          // Add backendMaxGraphNodes field for older versions
          state.backendMaxGraphNodes = null
        }
        if (version < 15) {
          // Add new querySettings
          state.querySettings = {
            ...state.querySettings,
            mode: 'mix',
            response_type: 'Multiple Paragraphs',
            top_k: 40,
            chunk_top_k: 10,
            max_entity_tokens: 10000,
            max_relation_tokens: 10000,
            max_total_tokens: 32000,
            enable_rerank: true,
            history_turns: 0
          }
        }
        if (version < 16) {
          // Add documentsPageSize field for older versions
          state.documentsPageSize = 10
        }
        if (version < 17) {
          // Force history_turns to 0 for all users
          if (state.querySettings) {
            state.querySettings.history_turns = 0
          }
        }
        if (version < 18) {
          // Add userPromptHistory field for older versions
          state.userPromptHistory = []
        }
        if (version < 19) {
          // Remove deprecated response_type parameter
          if (state.querySettings) {
            delete state.querySettings.response_type
          }
        }
        if (version < 20) {
          if (state.querySettings && !('prompt_overrides' in state.querySettings)) {
            state.querySettings.prompt_overrides = undefined
          }
        }
        if (version < 21) {
          state.promptManagementGroup = 'retrieval'
          state.promptManagementSelectedVersionId = null
          state.retrievalPromptVersionSelection = 'active'
          state.retrievalPromptDraft = undefined
        }
        if (version < 22) {
          if (!state.retrievalPromptDraft && state.querySettings?.prompt_overrides) {
            state.retrievalPromptDraft = state.querySettings.prompt_overrides
          }
        }
        if (version < 23) {
          state.currentWorkspace = ''
        }
        if (version < 24) {
          state.workspaceDisplayNames = {}
        }
        if (version < 25) {
          state.querySettings = {
            ...state.querySettings,
            include_references: state.querySettings?.include_references ?? true,
            include_chunk_content: state.querySettings?.include_chunk_content ?? false
          }
        }
        if (version < 26) {
          state.graphLayoutRepulsion = DEFAULT_LAYOUT_PARAMS.repulsion
          state.graphLayoutGravity = DEFAULT_LAYOUT_PARAMS.gravity
          state.graphLayoutMargin = DEFAULT_LAYOUT_PARAMS.margin
        }
        if (version < 27) {
          state.graphLayoutAttraction = DEFAULT_LAYOUT_PARAMS.attraction
          state.graphLayoutInertia = DEFAULT_LAYOUT_PARAMS.inertia
          state.graphLayoutMaxMove = DEFAULT_LAYOUT_PARAMS.maxMove
          state.graphLayoutExpansion = DEFAULT_LAYOUT_PARAMS.expansion
          state.graphLayoutGridSize = DEFAULT_LAYOUT_PARAMS.gridSize
          state.graphLayoutRatio = DEFAULT_LAYOUT_PARAMS.ratio
          state.graphLayoutSpeed = DEFAULT_LAYOUT_PARAMS.speed
        }
        if (version < 28) {
          state.enableSearchLinkedDrag = false
        }
        if (version < 29) {
          state.graphLabelFontSize = 12
        }
        if (version < 30) {
          state.showDirectionalArrows = false
        }
        return state
      }
    }
  )
)

const useSettingsStore = createSelectors(useSettingsStoreBase)

export { useSettingsStore, type Theme }
