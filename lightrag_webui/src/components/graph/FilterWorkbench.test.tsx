import React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

import type { GraphWorkbenchQueryRequest } from '@/api/lightrag'
import en from '@/locales/en.json'
import zh from '@/locales/zh.json'
import {
  useGraphWorkbenchStore,
  getDefaultGraphWorkbenchFilterDraft
} from '@/stores/graphWorkbench'
import GraphWorkbenchSummary from './GraphWorkbenchSummary'

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  configurable: true
})

let currentLanguage: 'en' | 'zh' = 'en'

const resolveTranslation = (catalog: Record<string, unknown>, key: string): string | undefined => {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, catalog) as string | undefined
}

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const catalog = currentLanguage === 'zh' ? (zh as Record<string, unknown>) : (en as Record<string, unknown>)
      const template = resolveTranslation(catalog, key)
      if (typeof template !== 'string') {
        return key
      }
      if (!values) {
        return template
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_, token) => String(values[token] ?? ''))
    }
  })
}))

vi.mock('@/api/lightrag', () => ({
  createGraphEntity: vi.fn(async () => ({ status: 'success' })),
  createGraphRelation: vi.fn(async () => ({ status: 'success' })),
  mergeGraphEntities: vi.fn(async () => ({ status: 'success' })),
  deleteGraphEntity: vi.fn(async () => ({ status: 'success' })),
  deleteGraphRelation: vi.fn(async () => ({ status: 'success' })),
  fetchMergeSuggestions: vi.fn(async () => ({ candidates: [], meta: { llm_used: false } })),
  getGraphEntityTypes: vi.fn(async () => ['PERSON', 'ORGANIZATION']),
  getPopularLabels: vi.fn(async () => ['*', 'Tesla']),
  searchLabels: vi.fn(async (query: string) => [query])
}))

const loadFilterWorkbenchModule = () => import('./FilterWorkbench')

const cloneDraft = (draft: GraphWorkbenchQueryRequest): GraphWorkbenchQueryRequest =>
  JSON.parse(JSON.stringify(draft))

const getValueAtPath = (obj: Record<string, unknown>, path: string): unknown => {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

describe('FilterWorkbench', () => {
  beforeEach(() => {
    currentLanguage = 'en'
    useGraphWorkbenchStore.getState().reset()
  })

  test('可渲染五类筛选区块', async () => {
    const { FilterWorkbench } = await loadFilterWorkbenchModule()
    const html = renderToString(<FilterWorkbench />)

    expect(html).toContain('Node Filters')
    expect(html).toContain('Edge Filters')
    expect(html).toContain('Scope Filters')
    expect(html).toContain('Source Filters')
    expect(html).toContain('View Controls')
  })

  test('收起状态会隐藏筛选内容并保留展开控件', async () => {
    const { FilterWorkbench } = await loadFilterWorkbenchModule()
    const html = renderToString(<FilterWorkbench collapsed onToggleCollapsed={() => undefined} />)

    expect(html).toContain('aria-label="Expand Filters"')
    expect(html).not.toContain('Node Filters')
    expect(html).not.toContain('Apply')
  })

  test('成对字段在桌面侧栏宽度下不会固定双列挤压', async () => {
    const { FilterWorkbench } = await loadFilterWorkbenchModule()
    const html = renderToString(<FilterWorkbench />)

    expect(html).toContain('sm:grid-cols-2')
    expect(html).toContain('lg:grid-cols-1')
    expect(html).not.toContain('grid grid-cols-2 gap-2')
  })

  test('实体类型和起始标签字段使用可搜索下拉', async () => {
    const { FilterWorkbench } = await loadFilterWorkbenchModule()
    const html = renderToString(<FilterWorkbench />)
    const comboboxCount = html.match(/role="combobox"/g)?.length ?? 0

    expect(comboboxCount).toBeGreaterThanOrEqual(4)
    expect(html).toContain('aria-label="Entity Types"')
    expect(html).toContain('aria-label="Source Entity Types"')
    expect(html).toContain('aria-label="Target Entity Types"')
    expect(html).toContain('aria-label="Start Label"')
  })

  test('空状态的筛选下拉不显示占位文字', async () => {
    const { FilterWorkbench } = await loadFilterWorkbenchModule()
    const html = renderToString(<FilterWorkbench />)

    expect(html).not.toContain('PERSON, ORGANIZATION')
    expect(html).not.toMatch(/aria-label="Start Label"[^>]*><div>\*<\/div>/)
  })

  test('apply / reset 行为会更新 appliedQuery', async () => {
    const { applyWorkbenchFilters, resetWorkbenchFilters } = await loadFilterWorkbenchModule()
    const store = useGraphWorkbenchStore.getState()
    const beforeVersion = store.queryVersion
    const draft = getDefaultGraphWorkbenchFilterDraft()
    draft.scope.label = 'Tesla'
    draft.scope.max_depth = 2
    draft.node_filters.entity_types = ['ORGANIZATION']
    draft.view_options.highlight_matches = true
    store.setFilterDraft(draft)

    applyWorkbenchFilters()
    const applied = useGraphWorkbenchStore.getState().appliedQuery
    expect(applied?.scope.label).toBe('Tesla')
    expect(applied?.node_filters.entity_types).toEqual(['ORGANIZATION'])
    expect(useGraphWorkbenchStore.getState().queryVersion).toBe(beforeVersion + 1)

    resetWorkbenchFilters()
    const state = useGraphWorkbenchStore.getState()
    const defaults = getDefaultGraphWorkbenchFilterDraft()
    expect(state.appliedQuery).toEqual(defaults)
    expect(state.filterDraft).toEqual(defaults)
    expect(state.queryVersion).toBe(beforeVersion + 2)
  })

  test('summary metadata 展示 applied 状态与统计信息', () => {
    const draft = getDefaultGraphWorkbenchFilterDraft()
    draft.scope.label = 'OpenAI'
    draft.scope.max_depth = 4

    const applied = cloneDraft(draft)
    applied.node_filters.entity_types = ['ORGANIZATION']
    applied.edge_filters.relation_types = ['cooperate']
    applied.view_options.highlight_matches = true

    const html = renderToString(
      <GraphWorkbenchSummary
        draft={draft}
        appliedQuery={applied}
        queryVersion={3}
        nodeCount={12}
        edgeCount={18}
      />
    )
    const normalizedHtml = html.replaceAll('<!-- -->', '')

    expect(normalizedHtml).toContain('Applied')
    expect(normalizedHtml).toContain('Version 3')
    expect(normalizedHtml).toContain('Scope OpenAI · D4 · N1000')
    expect(normalizedHtml).toContain('Result 12 nodes / 18 edges')
    expect(normalizedHtml).toContain('Active Groups 3')
  })

  test('输入变化会驱动 structured payload 更新', async () => {
    const { updateDraftFromInput } = await loadFilterWorkbenchModule()
    const draft = getDefaultGraphWorkbenchFilterDraft()

    const withEntityTypes = updateDraftFromInput(
      draft,
      'node_filters',
      'entity_types',
      'PERSON, ORGANIZATION'
    )
    expect(withEntityTypes.node_filters.entity_types).toEqual(['PERSON', 'ORGANIZATION'])

    const withDepth = updateDraftFromInput(withEntityTypes, 'scope', 'max_depth', '5')
    expect(withDepth.scope.max_depth).toBe(5)

    const withWeight = updateDraftFromInput(withDepth, 'edge_filters', 'weight_min', '0.75')
    expect(withWeight.edge_filters.weight_min).toBe(0.75)

    const withTime = updateDraftFromInput(
      withWeight,
      'source_filters',
      'time_from',
      '2026-03-25T09:30'
    )
    expect(withTime.source_filters.time_from).toBe('2026-03-25T09:30')

    const withToggle = updateDraftFromInput(withTime, 'view_options', 'highlight_matches', true)
    expect(withToggle.view_options.highlight_matches).toBe(true)

    const clearedWeight = updateDraftFromInput(withToggle, 'edge_filters', 'weight_min', '')
    expect(clearedWeight.edge_filters.weight_min).toBeNull()

    const keptDepth = updateDraftFromInput(withToggle, 'scope', 'max_depth', '')
    expect(keptDepth.scope.max_depth).toBe(withToggle.scope.max_depth)

    const clampedNodes = updateDraftFromInput(withToggle, 'scope', 'max_nodes', '-1')
    expect(clampedNodes.scope.max_nodes).toBe(1)
  })

  test('结构化选择值会以克隆方式写回 draft', async () => {
    const { updateDraftFromValue } = await loadFilterWorkbenchModule()
    const draft = getDefaultGraphWorkbenchFilterDraft()

    const withEntityTypes = updateDraftFromValue(draft, 'node_filters', 'entity_types', [
      'PERSON',
      'ORGANIZATION'
    ])
    expect(withEntityTypes.node_filters.entity_types).toEqual(['PERSON', 'ORGANIZATION'])
    expect(draft.node_filters.entity_types).toEqual([])

    const withLabel = updateDraftFromValue(withEntityTypes, 'scope', 'label', 'OpenAI')
    expect(withLabel.scope.label).toBe('OpenAI')
    expect(withEntityTypes.scope.label).toBe('*')
  })

  test('起始标签下拉选项会保留通配符和自定义输入', async () => {
    const { buildLabelSelectOptions } = await loadFilterWorkbenchModule()
    expect(buildLabelSelectOptions('', ['Tesla', '*'], '')).toEqual(['*', 'Tesla'])

    expect(buildLabelSelectOptions('OpenAI', ['Tesla'], 'Anthropic')).toEqual([
      '*',
      'OpenAI',
      'Tesla',
      'Anthropic'
    ])

    expect(buildLabelSelectOptions('  Tesla ', ['Tesla', 'OpenAI'], 'Tesla')).toEqual([
      '*',
      'Tesla',
      'OpenAI'
    ])
  })

  test('graph workbench 关键 i18n key 在 en 与 zh 中存在', () => {
    const keyPaths = [
      'graphPanel.workbench.summary.draftStatus',
      'graphPanel.workbench.summary.appliedStatus',
      'graphPanel.workbench.filter.sections.nodeFilters',
      'graphPanel.workbench.filter.title',
      'graphPanel.workbench.filter.actions.collapse',
      'graphPanel.workbench.filter.actions.expand',
      'graphPanel.workbench.filter.actions.removeSelection',
      'graphPanel.workbench.filter.actions.apply',
      'graphPanel.workbench.filter.placeholders.searchEntityTypes',
      'graphPanel.workbench.filter.placeholders.searchStartLabel',
      'graphPanel.workbench.filter.messages.noEntityTypeResults',
      'graphPanel.workbench.filter.messages.noLabelResults',
      'graphPanel.workbench.actionInspector.title',
      'graphPanel.workbench.actionInspector.tabs.merge',
      'graphPanel.workbench.merge.manual.title',
      'graphPanel.workbench.merge.suggestions.title'
    ]

    keyPaths.forEach((path) => {
      expect(getValueAtPath(en as Record<string, unknown>, path)).toBeTruthy()
      expect(getValueAtPath(zh as Record<string, unknown>, path)).toBeTruthy()
    })
  })
})
