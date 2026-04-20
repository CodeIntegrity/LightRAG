import { useCallback, type ReactNode } from 'react'
import {
  getGraphEntityTypes,
  getPopularLabels,
  searchLabels,
  type GraphWorkbenchQueryRequest
} from '@/api/lightrag'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { useTranslation } from 'react-i18next'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { AsyncSelect } from '@/components/ui/AsyncSelect'
import {
  dropdownDisplayLimit,
  popularLabelsDefaultLimit,
  searchLabelsDefaultLimit
} from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  getDefaultGraphWorkbenchFilterDraft,
  useGraphWorkbenchStore
} from '@/stores/graphWorkbench'
import { useGraphStore } from '@/stores/graph'
import GraphWorkbenchSummary from './GraphWorkbenchSummary'

type DraftSection = keyof GraphWorkbenchQueryRequest

const listFields = new Set([
  'entity_types',
  'relation_types',
  'source_entity_types',
  'target_entity_types',
  'file_paths'
])

const nullableNumberFields = new Set(['degree_min', 'degree_max', 'weight_min', 'weight_max'])

const parseListInput = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const parseNumberInput = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const cloneDraft = (query: GraphWorkbenchQueryRequest): GraphWorkbenchQueryRequest => ({
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
})

const normalizeScopeNumber = (rawValue: string, currentValue: number, minValue: number): number => {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return currentValue
  }
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed)) {
    return currentValue
  }
  return Math.max(minValue, parsed)
}

const normalizeStringOptions = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

const appendUniqueValue = (values: string[], nextValue: string): string[] => {
  const trimmed = nextValue.trim()
  if (!trimmed || values.includes(trimmed)) {
    return values
  }
  return [...values, trimmed]
}

const removeValue = (values: string[], targetValue: string): string[] =>
  values.filter((value) => value !== targetValue)

export const updateDraftFromInput = <
  TSection extends DraftSection,
  TField extends keyof GraphWorkbenchQueryRequest[TSection]
>(
  draft: GraphWorkbenchQueryRequest,
  section: TSection,
  field: TField,
  rawValue: string | boolean
): GraphWorkbenchQueryRequest => {
  const nextDraft = cloneDraft(draft)
  const key = String(field)
  const sectionDraft = nextDraft[section] as Record<string, unknown>
  if (typeof rawValue === 'boolean') {
    sectionDraft[key] = rawValue
    return nextDraft
  }

  if (listFields.has(key)) {
    sectionDraft[key] = parseListInput(rawValue)
    return nextDraft
  }

  if (nullableNumberFields.has(key)) {
    sectionDraft[key] = parseNumberInput(rawValue)
    return nextDraft
  }

  if (section === 'scope' && key === 'max_depth') {
    sectionDraft[key] = normalizeScopeNumber(rawValue, Number(nextDraft.scope.max_depth), 1)
    return nextDraft
  }

  if (section === 'scope' && key === 'max_nodes') {
    sectionDraft[key] = normalizeScopeNumber(rawValue, Number(nextDraft.scope.max_nodes), 1)
    return nextDraft
  }

  if (section === 'source_filters' && (key === 'time_from' || key === 'time_to')) {
    const trimmed = rawValue.trim()
    sectionDraft[key] = trimmed || null
    return nextDraft
  }

  sectionDraft[key] = rawValue
  return nextDraft
}

export const updateDraftFromValue = <
  TSection extends DraftSection,
  TField extends keyof GraphWorkbenchQueryRequest[TSection]
>(
  draft: GraphWorkbenchQueryRequest,
  section: TSection,
  field: TField,
  value: GraphWorkbenchQueryRequest[TSection][TField]
): GraphWorkbenchQueryRequest => {
  const nextDraft = cloneDraft(draft)
  const key = String(field)
  const sectionDraft = nextDraft[section] as Record<string, unknown>
  sectionDraft[key] = Array.isArray(value) ? [...value] : value
  return nextDraft
}

export const buildLabelSelectOptions = (
  query: string,
  labels: string[],
  currentValue: string
): string[] => {
  const normalizedQuery = query.trim()
  const normalizedCurrentValue = currentValue.trim()
  const normalizedLabels = normalizeStringOptions(labels.filter((label) => label !== '*'))

  return [
    '*',
    ...normalizeStringOptions([
      ...(normalizedQuery && normalizedQuery !== '*' ? [normalizedQuery] : []),
      ...normalizedLabels,
      ...(normalizedCurrentValue && normalizedCurrentValue !== '*' ? [normalizedCurrentValue] : [])
    ])
  ]
}

export const applyWorkbenchFilters = () => {
  useGraphWorkbenchStore.getState().applyFilterDraft()
}

export const resetWorkbenchFilters = () => {
  const defaults = getDefaultGraphWorkbenchFilterDraft()
  const store = useGraphWorkbenchStore.getState()
  store.setFilterDraft(defaults)
  store.applyFilterDraft()
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="bg-background/70 rounded-lg border p-3">
    <h3 className="mb-2 text-sm font-semibold">{title}</h3>
    <div className="space-y-2">{children}</div>
  </section>
)

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
    {children}
  </label>
)

const pairFieldGridClass = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1'

const StringSelectOption = ({ value }: { value: string }) => (
  <div className="truncate" title={value}>
    {value}
  </div>
)

const StringSelectValue = ({ value }: { value: string }) => (
  <div className="min-w-0 flex-1 truncate text-left" title={value}>
    {value}
  </div>
)

const EmptySelectTrigger = () => <span className="min-w-0 flex-1" aria-hidden="true" />

const TextField = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  type?: 'text' | 'number' | 'datetime-local'
  placeholder?: string
}) => (
  <div className="min-w-0 space-y-1">
    <FieldLabel>{label}</FieldLabel>
    <Input
      type={type}
      value={value}
      className="w-full min-w-0"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  </div>
)

const ToggleField = ({
  label,
  checked,
  onCheckedChange
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) => (
  <label className="flex items-center gap-2 text-sm">
    <Checkbox checked={checked} onCheckedChange={(next) => onCheckedChange(next === true)} />
    <span>{label}</span>
  </label>
)

const SearchableSelectField = ({
  label,
  value,
  placeholder,
  searchPlaceholder,
  noResultsMessage,
  fetcher,
  onChange
}: {
  label: string
  value: string
  placeholder: string
  searchPlaceholder: string
  noResultsMessage: string
  fetcher: (query?: string) => Promise<string[]>
  onChange: (value: string) => void
}) => (
  <div className="min-w-0 space-y-1">
    <FieldLabel>{label}</FieldLabel>
    <AsyncSelect<string>
      className="w-[var(--radix-popover-trigger-width)] min-w-[240px]"
      triggerClassName="w-full min-w-0 justify-between overflow-hidden"
      fetcher={fetcher}
      renderOption={(item) => <StringSelectOption value={item} />}
      getOptionValue={(item) => item}
      getDisplayValue={(item) => <StringSelectValue value={item} />}
      ariaLabel={label}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      noResultsMessage={noResultsMessage}
      emptyDisplay={<EmptySelectTrigger />}
      clearable={false}
      hideDisplayWhen={(currentValue) => currentValue === '*'}
      value={value}
      onChange={onChange}
    />
  </div>
)

const SearchableMultiSelectField = ({
  label,
  selectedValues,
  placeholder,
  searchPlaceholder,
  noResultsMessage,
  removeSelectionLabel,
  fetcher,
  onAddValue,
  onRemoveValue
}: {
  label: string
  selectedValues: string[]
  placeholder: string
  searchPlaceholder: string
  noResultsMessage: string
  removeSelectionLabel: (value: string) => string
  fetcher: (query?: string) => Promise<string[]>
  onAddValue: (value: string) => void
  onRemoveValue: (value: string) => void
}) => {
  const fetchOptions = useCallback(async () => {
    const options = await fetcher()
    return options.filter((option) => !selectedValues.includes(option))
  }, [fetcher, selectedValues])

  return (
    <div className="min-w-0 space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <AsyncSelect<string>
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px]"
        triggerClassName="w-full min-w-0 justify-between overflow-hidden"
        fetcher={fetchOptions}
        preload
        filterFn={(option, query) => option.toLowerCase().includes(query.trim().toLowerCase())}
        renderOption={(item) => <StringSelectOption value={item} />}
        getOptionValue={(item) => item}
        getDisplayValue={(item) => <StringSelectValue value={item} />}
        ariaLabel={label}
        placeholder=""
        searchPlaceholder={searchPlaceholder}
        noResultsMessage={noResultsMessage}
        emptyDisplay={<EmptySelectTrigger />}
        clearable={false}
        value=""
        onChange={(value) => {
          if (value) {
            onAddValue(value)
          }
        }}
      />
      {selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((value) => (
            <Badge key={value} variant="secondary" className="max-w-full gap-1 pr-1">
              <span className="max-w-[11rem] truncate" title={value}>
                {value}
              </span>
              <button
                type="button"
                className="hover:bg-background/80 rounded-sm p-0.5 transition-colors"
                aria-label={removeSelectionLabel(value)}
                onClick={() => onRemoveValue(value)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

type FilterWorkbenchProps = {
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export const FilterWorkbench = ({
  collapsed = false,
  onToggleCollapsed
}: FilterWorkbenchProps = {}) => {
  const { t } = useTranslation()
  const filterDraft = useGraphWorkbenchStore.use.filterDraft()
  const appliedQuery = useGraphWorkbenchStore.use.appliedQuery()
  const queryVersion = useGraphWorkbenchStore.use.queryVersion()
  const setFilterDraft = useGraphWorkbenchStore.use.setFilterDraft()
  const rawGraph = useGraphStore.use.rawGraph()
  const toggleLabel = t(
    collapsed
      ? 'graphPanel.workbench.filter.actions.expand'
      : 'graphPanel.workbench.filter.actions.collapse'
  )

  const nodeCount = rawGraph?.nodes.length ?? 0
  const edgeCount = rawGraph?.edges.length ?? 0
  const removeSelectionLabel = (value: string) =>
    t('graphPanel.workbench.filter.actions.removeSelection', { value })

  const fetchEntityTypeOptions = useCallback(async () => {
    const entityTypes = await getGraphEntityTypes()
    return normalizeStringOptions(entityTypes).slice(0, dropdownDisplayLimit)
  }, [])

  const fetchStartLabelOptions = useCallback(
    async (query?: string) => {
      const normalizedQuery = query?.trim() ?? ''
      const labels = normalizedQuery
        ? await searchLabels(normalizedQuery, searchLabelsDefaultLimit)
        : await getPopularLabels(popularLabelsDefaultLimit)

      return buildLabelSelectOptions(
        normalizedQuery,
        labels.slice(0, dropdownDisplayLimit),
        filterDraft.scope.label
      )
    },
    [filterDraft.scope.label]
  )

  const updateField = <
    TSection extends DraftSection,
    TField extends keyof GraphWorkbenchQueryRequest[TSection]
  >(
    section: TSection,
    field: TField,
    value: string | boolean
  ) => {
    const nextDraft = updateDraftFromInput(filterDraft, section, field, value)
    setFilterDraft(nextDraft)
  }

  const updateStructuredField = <
    TSection extends DraftSection,
    TField extends keyof GraphWorkbenchQueryRequest[TSection]
  >(
    section: TSection,
    field: TField,
    value: GraphWorkbenchQueryRequest[TSection][TField]
  ) => {
    const nextDraft = updateDraftFromValue(filterDraft, section, field, value)
    setFilterDraft(nextDraft)
  }

  return (
    <div
      className={cn(
        'bg-background/80 h-full rounded-xl border backdrop-blur-sm',
        collapsed && 'overflow-hidden'
      )}
    >
      <div
        className={cn(
          'flex h-full flex-col gap-3 p-3',
          collapsed && 'items-center justify-start px-2 py-3'
        )}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-2',
            collapsed && 'h-full w-full flex-col items-center justify-start'
          )}
        >
          {!collapsed && (
            <h2 className="min-w-0 text-sm font-semibold">
              {t('graphPanel.workbench.filter.title')}
            </h2>
          )}
          <Button
            size="icon"
            variant="outline"
            className="shrink-0"
            onClick={onToggleCollapsed}
            aria-label={toggleLabel}
            aria-controls="graph-filter-workbench-body"
            aria-expanded={!collapsed}
            tooltip={toggleLabel}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>

        {!collapsed && (
          <>
            <GraphWorkbenchSummary
              draft={filterDraft}
              appliedQuery={appliedQuery}
              queryVersion={queryVersion}
              nodeCount={nodeCount}
              edgeCount={edgeCount}
            />

            <ScrollArea id="graph-filter-workbench-body" className="min-h-0 flex-1 pr-2">
              <div className="space-y-3 pr-1">
                <Section title={t('graphPanel.workbench.filter.sections.nodeFilters')}>
                  <SearchableMultiSelectField
                    label={t('graphPanel.workbench.filter.fields.entityTypes')}
                    selectedValues={filterDraft.node_filters.entity_types}
                    placeholder={t('graphPanel.workbench.filter.placeholders.entityTypes')}
                    searchPlaceholder={t(
                      'graphPanel.workbench.filter.placeholders.searchEntityTypes'
                    )}
                    noResultsMessage={t('graphPanel.workbench.filter.messages.noEntityTypeResults')}
                    removeSelectionLabel={removeSelectionLabel}
                    fetcher={fetchEntityTypeOptions}
                    onAddValue={(value) =>
                      updateStructuredField(
                        'node_filters',
                        'entity_types',
                        appendUniqueValue(filterDraft.node_filters.entity_types, value)
                      )
                    }
                    onRemoveValue={(value) =>
                      updateStructuredField(
                        'node_filters',
                        'entity_types',
                        removeValue(filterDraft.node_filters.entity_types, value)
                      )
                    }
                  />
                  <TextField
                    label={t('graphPanel.workbench.filter.fields.nameQuery')}
                    value={filterDraft.node_filters.name_query}
                    onChange={(value) => updateField('node_filters', 'name_query', value)}
                  />
                  <TextField
                    label={t('graphPanel.workbench.filter.fields.descriptionQuery')}
                    value={filterDraft.node_filters.description_query}
                    onChange={(value) => updateField('node_filters', 'description_query', value)}
                  />
                  <div className={pairFieldGridClass}>
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.degreeMin')}
                      type="number"
                      value={filterDraft.node_filters.degree_min ?? ''}
                      onChange={(value) => updateField('node_filters', 'degree_min', value)}
                    />
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.degreeMax')}
                      type="number"
                      value={filterDraft.node_filters.degree_max ?? ''}
                      onChange={(value) => updateField('node_filters', 'degree_max', value)}
                    />
                  </div>
                  <ToggleField
                    label={t('graphPanel.workbench.filter.fields.isolatedOnly')}
                    checked={filterDraft.node_filters.isolated_only}
                    onCheckedChange={(checked) =>
                      updateField('node_filters', 'isolated_only', checked)
                    }
                  />
                </Section>

                <Section title={t('graphPanel.workbench.filter.sections.edgeFilters')}>
                  <TextField
                    label={t('graphPanel.workbench.filter.fields.relationTypes')}
                    value={filterDraft.edge_filters.relation_types.join(', ')}
                    placeholder={t('graphPanel.workbench.filter.placeholders.relationTypes')}
                    onChange={(value) => updateField('edge_filters', 'relation_types', value)}
                  />
                  <TextField
                    label={t('graphPanel.workbench.filter.fields.keywordQuery')}
                    value={filterDraft.edge_filters.keyword_query}
                    onChange={(value) => updateField('edge_filters', 'keyword_query', value)}
                  />
                  <div className={pairFieldGridClass}>
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.weightMin')}
                      type="number"
                      value={filterDraft.edge_filters.weight_min ?? ''}
                      onChange={(value) => updateField('edge_filters', 'weight_min', value)}
                    />
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.weightMax')}
                      type="number"
                      value={filterDraft.edge_filters.weight_max ?? ''}
                      onChange={(value) => updateField('edge_filters', 'weight_max', value)}
                    />
                  </div>
                  <SearchableMultiSelectField
                    label={t('graphPanel.workbench.filter.fields.sourceEntityTypes')}
                    selectedValues={filterDraft.edge_filters.source_entity_types}
                    placeholder={t('graphPanel.workbench.filter.placeholders.entityTypes')}
                    searchPlaceholder={t(
                      'graphPanel.workbench.filter.placeholders.searchEntityTypes'
                    )}
                    noResultsMessage={t('graphPanel.workbench.filter.messages.noEntityTypeResults')}
                    removeSelectionLabel={removeSelectionLabel}
                    fetcher={fetchEntityTypeOptions}
                    onAddValue={(value) =>
                      updateStructuredField(
                        'edge_filters',
                        'source_entity_types',
                        appendUniqueValue(filterDraft.edge_filters.source_entity_types, value)
                      )
                    }
                    onRemoveValue={(value) =>
                      updateStructuredField(
                        'edge_filters',
                        'source_entity_types',
                        removeValue(filterDraft.edge_filters.source_entity_types, value)
                      )
                    }
                  />
                  <SearchableMultiSelectField
                    label={t('graphPanel.workbench.filter.fields.targetEntityTypes')}
                    selectedValues={filterDraft.edge_filters.target_entity_types}
                    placeholder={t('graphPanel.workbench.filter.placeholders.entityTypes')}
                    searchPlaceholder={t(
                      'graphPanel.workbench.filter.placeholders.searchEntityTypes'
                    )}
                    noResultsMessage={t('graphPanel.workbench.filter.messages.noEntityTypeResults')}
                    removeSelectionLabel={removeSelectionLabel}
                    fetcher={fetchEntityTypeOptions}
                    onAddValue={(value) =>
                      updateStructuredField(
                        'edge_filters',
                        'target_entity_types',
                        appendUniqueValue(filterDraft.edge_filters.target_entity_types, value)
                      )
                    }
                    onRemoveValue={(value) =>
                      updateStructuredField(
                        'edge_filters',
                        'target_entity_types',
                        removeValue(filterDraft.edge_filters.target_entity_types, value)
                      )
                    }
                  />
                </Section>

                <Section title={t('graphPanel.workbench.filter.sections.scopeFilters')}>
                  <SearchableSelectField
                    label={t('graphPanel.workbench.filter.fields.startLabel')}
                    value={filterDraft.scope.label}
                    placeholder={t('graphPanel.workbench.filter.placeholders.startLabel')}
                    searchPlaceholder={t(
                      'graphPanel.workbench.filter.placeholders.searchStartLabel'
                    )}
                    noResultsMessage={t('graphPanel.workbench.filter.messages.noLabelResults')}
                    fetcher={fetchStartLabelOptions}
                    onChange={(value) => updateStructuredField('scope', 'label', value)}
                  />
                  <div className={pairFieldGridClass}>
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.maxDepth')}
                      type="number"
                      value={filterDraft.scope.max_depth}
                      onChange={(value) => updateField('scope', 'max_depth', value)}
                    />
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.maxNodes')}
                      type="number"
                      value={filterDraft.scope.max_nodes}
                      onChange={(value) => updateField('scope', 'max_nodes', value)}
                    />
                  </div>
                  <ToggleField
                    label={t('graphPanel.workbench.filter.fields.onlyMatchedNeighborhood')}
                    checked={filterDraft.scope.only_matched_neighborhood}
                    onCheckedChange={(checked) =>
                      updateField('scope', 'only_matched_neighborhood', checked)
                    }
                  />
                </Section>

                <Section title={t('graphPanel.workbench.filter.sections.sourceFilters')}>
                  <TextField
                    label={t('graphPanel.workbench.filter.fields.sourceIdQuery')}
                    value={filterDraft.source_filters.source_id_query}
                    onChange={(value) => updateField('source_filters', 'source_id_query', value)}
                  />
                  <TextField
                    label={t('graphPanel.workbench.filter.fields.filePaths')}
                    value={filterDraft.source_filters.file_paths.join(', ')}
                    placeholder={t('graphPanel.workbench.filter.placeholders.filePaths')}
                    onChange={(value) => updateField('source_filters', 'file_paths', value)}
                  />
                  <div className={pairFieldGridClass}>
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.timeFrom')}
                      type="datetime-local"
                      value={filterDraft.source_filters.time_from ?? ''}
                      onChange={(value) => updateField('source_filters', 'time_from', value)}
                    />
                    <TextField
                      label={t('graphPanel.workbench.filter.fields.timeTo')}
                      type="datetime-local"
                      value={filterDraft.source_filters.time_to ?? ''}
                      onChange={(value) => updateField('source_filters', 'time_to', value)}
                    />
                  </div>
                </Section>

                <Section title={t('graphPanel.workbench.filter.sections.viewControls')}>
                  <ToggleField
                    label={t('graphPanel.workbench.filter.fields.showNodesOnly')}
                    checked={filterDraft.view_options.show_nodes_only}
                    onCheckedChange={(checked) =>
                      updateField('view_options', 'show_nodes_only', checked)
                    }
                  />
                  <ToggleField
                    label={t('graphPanel.workbench.filter.fields.showEdgesOnly')}
                    checked={filterDraft.view_options.show_edges_only}
                    onCheckedChange={(checked) =>
                      updateField('view_options', 'show_edges_only', checked)
                    }
                  />
                  <ToggleField
                    label={t('graphPanel.workbench.filter.fields.hideLowWeightEdges')}
                    checked={filterDraft.view_options.hide_low_weight_edges}
                    onCheckedChange={(checked) =>
                      updateField('view_options', 'hide_low_weight_edges', checked)
                    }
                  />
                  <ToggleField
                    label={t('graphPanel.workbench.filter.fields.hideEmptyDescription')}
                    checked={filterDraft.view_options.hide_empty_description}
                    onCheckedChange={(checked) =>
                      updateField('view_options', 'hide_empty_description', checked)
                    }
                  />
                  <ToggleField
                    label={t('graphPanel.workbench.filter.fields.highlightMatches')}
                    checked={filterDraft.view_options.highlight_matches}
                    onCheckedChange={(checked) =>
                      updateField('view_options', 'highlight_matches', checked)
                    }
                  />
                </Section>
              </div>
            </ScrollArea>

            <div className="flex items-center gap-2">
              <Button size="sm" className="flex-1" onClick={applyWorkbenchFilters}>
                {t('graphPanel.workbench.filter.actions.apply')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={resetWorkbenchFilters}
              >
                {t('graphPanel.workbench.filter.actions.reset')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default FilterWorkbench
