import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GraphSearchInputProps, GraphSearchContextProviderProps } from '@react-sigma/graph-search'
import { AsyncSearch } from '@/components/ui/AsyncSearch'
import { searchLabels } from '@/api/lightrag'
import { searchLabelsDefaultLimit, searchResultLimit } from '@/lib/constants'
import { useGraphStore } from '@/stores/graph'
import { useGraphWorkbenchStore } from '@/stores/graphWorkbench'
import { useSettingsStore } from '@/stores/settings'
import MiniSearch from 'minisearch'
import { useTranslation } from 'react-i18next'
import { createMergeEntityNavigationPlan } from '@/utils/mergeEntity'
import {
  buildGraphSearchIndexKey,
  type GraphSearchOptionItem,
  graphSearchMessageId,
  limitGraphSearchOptions,
  mapRemoteLabelsToOptions,
  mergeGraphSearchOptions,
  resolveGraphSearchSelection,
  searchLocalGraphNodes,
  shouldFetchRemoteGraphLabels
} from '@/utils/graphSearch'

export type OptionItem = GraphSearchOptionItem

const graphSearchDebounceMs = 300
const localGraphContainsScanNodeLimit = 1500
const localGraphSearchIndexNodeLimit = 2000

const NodeOption = ({ id }: { id: string }) => {
  const graph = useGraphStore.use.sigmaGraph()

  // Early return if no graph or node doesn't exist
  if (!graph?.hasNode(id)) {
    return null
  }

  // Safely get node attributes with fallbacks
  const label = graph.getNodeAttribute(id, 'label') || id
  const color = graph.getNodeAttribute(id, 'color') || '#666'
  const size = graph.getNodeAttribute(id, 'size') || 4

  // Custom node display component that doesn't rely on @react-sigma/graph-search
  return (
    <div className="flex items-center gap-2 p-2 text-sm">
      <div
        className="rounded-full flex-shrink-0"
        style={{
          width: Math.max(8, Math.min(size * 2, 16)),
          height: Math.max(8, Math.min(size * 2, 16)),
          backgroundColor: color
        }}
      />
      <span className="truncate">{label}</span>
    </div>
  )
}

function OptionComponent(item: OptionItem) {
  return (
    <div>
      {item.type === 'nodes' && <NodeOption id={item.id} />}
      {item.type === 'labels' && <div className="p-2 text-sm">{item.label ?? item.id}</div>}
      {item.type === 'message' && <div>{item.message}</div>}
    </div>
  )
}


/**
 * Component thats display the search input.
 */
export const GraphSearchInput = ({
  onChange,
  onFocus,
  value
}: {
  onChange: GraphSearchInputProps['onChange']
  onFocus?: GraphSearchInputProps['onFocus']
  value?: GraphSearchInputProps['value']
}) => {
  const { t } = useTranslation()
  const graph = useGraphStore.use.sigmaGraph()
  const rawGraph = useGraphStore.use.rawGraph()
  const searchEngine = useGraphStore.use.searchEngine()
  const searchEngineKey = useGraphStore.use.searchEngineKey()
  const appliedWorkbenchQuery = useGraphWorkbenchStore.use.appliedQuery()
  const queryLabel = useSettingsStore.use.queryLabel()
  const applyScopeLabel = useGraphWorkbenchStore.use.applyScopeLabel()
  const setQueryLabel = useSettingsStore.use.setQueryLabel()
  const [pendingNavigationEntity, setPendingNavigationEntity] = useState<string | null>(null)
  const latestOptionsRef = useRef<Map<string, OptionItem>>(new Map())
  const remoteSearchCacheRef = useRef<Map<string, OptionItem[]>>(new Map())

  const currentQueryLabel = useMemo(
    () => appliedWorkbenchQuery?.scope.label ?? queryLabel,
    [appliedWorkbenchQuery, queryLabel]
  )
  const graphSearchIndexKey = useMemo(
    () => buildGraphSearchIndexKey(rawGraph, localGraphSearchIndexNodeLimit),
    [rawGraph]
  )

  useEffect(() => {
    if (!pendingNavigationEntity) {
      return
    }

    const plan = createMergeEntityNavigationPlan(rawGraph, pendingNavigationEntity)
    if (!plan?.nodeId) {
      return
    }

    const graphStore = useGraphStore.getState()
    graphStore.setFocusedNode(plan.nodeId)
    graphStore.setSelectedNode(plan.nodeId, true)
    setPendingNavigationEntity(null)
  }, [rawGraph, pendingNavigationEntity])

  useEffect(() => {
    if (!graph || !rawGraph || graph.nodes().length === 0) {
      useGraphStore.getState().setSearchEngine(null)
      return
    }
    if (searchEngine && searchEngineKey === graphSearchIndexKey) {
      return
    }

    const newSearchEngine = new MiniSearch({
      idField: 'id',
      fields: ['label'],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: {
          label: 2
        }
      }
    })

    const documents = graph.nodes()
      .filter(id => graph.hasNode(id))
      .slice(0, localGraphSearchIndexNodeLimit)
      .map((id: string) => ({
        id,
        label: graph.getNodeAttribute(id, 'label')
      }))

    if (documents.length > 0) {
      newSearchEngine.addAll(documents)
    }

    useGraphStore.getState().setSearchEngine(newSearchEngine, graphSearchIndexKey)
  }, [graph, rawGraph, graphSearchIndexKey, searchEngine, searchEngineKey])

  useEffect(() => {
    remoteSearchCacheRef.current.clear()
  }, [graphSearchIndexKey])

  /**
   * Loading the options while the user is typing.
   */
  const loadOptions = useCallback(
    async (query?: string): Promise<OptionItem[]> => {
      if (onFocus) {
        onFocus(null)
      }

      const normalizedQuery = query?.trim() ?? ''
      const localOptions = searchLocalGraphNodes(
        graph,
        searchEngine,
        normalizedQuery,
        {
          initialLimit: searchResultLimit,
          maxContainsScanNodes: localGraphContainsScanNodeLimit
        }
      )

      let options = localOptions
      if (
        normalizedQuery &&
        shouldFetchRemoteGraphLabels(
          normalizedQuery,
          localOptions.length,
          searchResultLimit
        )
      ) {
        try {
          const cacheKey = normalizedQuery.toLowerCase()
          let remoteOptions = remoteSearchCacheRef.current.get(cacheKey)
          if (!remoteOptions) {
            const remoteLabels = await searchLabels(
              normalizedQuery,
              searchLabelsDefaultLimit
            )
            remoteOptions = mapRemoteLabelsToOptions(remoteLabels, rawGraph)
            remoteSearchCacheRef.current.set(cacheKey, remoteOptions)
          }
          options = mergeGraphSearchOptions(localOptions, remoteOptions)
        } catch {
          options = localOptions
        }
      }

      const limitedOptions = limitGraphSearchOptions(
        options,
        searchResultLimit,
        t('graphPanel.search.message', { count: options.length - searchResultLimit })
      )
      latestOptionsRef.current = new Map(limitedOptions.map((item) => [item.value, item]))
      return limitedOptions
    },
    [graph, onFocus, rawGraph, searchEngine, t]
  )

  return (
    <AsyncSearch
      className="bg-background/60 min-w-[11rem] max-w-full rounded-xl border-1 opacity-60 backdrop-blur-lg transition-opacity hover:opacity-100 sm:w-[14rem] lg:w-[16rem]"
      debounceTime={graphSearchDebounceMs}
      fetcher={loadOptions}
      renderOption={OptionComponent}
      getOptionValue={(item) => item.value}
      value={value && value.type !== 'message' ? `node:${value.id}` : null}
      onChange={(selectedValue) => {
        if (selectedValue === graphSearchMessageId) {
          return
        }

        const selectedItem = latestOptionsRef.current.get(selectedValue)
        const action = resolveGraphSearchSelection(selectedItem, currentQueryLabel)
        if (action.kind === 'select-node') {
          onChange({ id: action.nodeId, type: 'nodes' })
          return
        }

        if (action.kind !== 'query-label') {
          onChange(null)
          return
        }

        const graphStore = useGraphStore.getState()
        graphStore.setFocusedNode(null)
        graphStore.setSelectedNode(null)
        graphStore.setGraphDataFetchAttempted(false)
        graphStore.setLastSuccessfulQueryLabel('')
        setPendingNavigationEntity(action.label)
        if (appliedWorkbenchQuery) {
          applyScopeLabel(action.label)
        } else {
          setQueryLabel(action.label)
        }
        if (action.forceRefresh) {
          graphStore.incrementGraphDataVersion()
        }
        onChange(null)
      }}
      onFocus={(focusedValue) => {
        if (!onFocus || focusedValue === graphSearchMessageId) {
          return
        }

        const focusedItem = latestOptionsRef.current.get(focusedValue)
        const action = resolveGraphSearchSelection(focusedItem, currentQueryLabel)
        if (action.kind === 'select-node') {
          onFocus({ id: action.nodeId, type: 'nodes' })
          return
        }

        onFocus(null)
      }}
      ariaLabel={t('graphPanel.search.placeholder')}
      placeholder={t('graphPanel.search.placeholder')}
      noResultsMessage={t('graphPanel.search.placeholder')}
    />
  )
}

/**
 * Component that display the search.
 */
const GraphSearch: FC<GraphSearchInputProps & GraphSearchContextProviderProps> = ({ ...props }) => {
  return <GraphSearchInput {...props} />
}

export default GraphSearch
