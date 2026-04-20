import React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import en from '@/locales/en.json'
import {
  getDefaultGraphWorkbenchFilterDraft,
  normalizeWorkbenchMutationError,
  useGraphWorkbenchStore
} from '@/stores/graphWorkbench'
import type { GraphMergeSuggestionCandidate } from '@/api/lightrag'

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  configurable: true
})

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
      const template = resolveTranslation(en as Record<string, unknown>, key)
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

vi.mock('@/hooks/useLightragGraph', () => ({
  default: () => ({
    getNode: () => null,
    getEdge: () => null
  })
}))

vi.mock('./PropertiesView', () => ({
  default: () => <div>Mock PropertiesView</div>
}))

type ActionInspectorSelection = {
  kind: 'node' | 'edge'
  node?: any
  edge?: any
}

const nodeSelection: ActionInspectorSelection = {
  kind: 'node',
  node: {
    id: 'n-1',
    labels: ['Elon Musk'],
    properties: {
      entity_id: 'Elon Musk',
      description: 'CEO'
    },
    size: 10,
    x: 0,
    y: 0,
    color: '#000000',
    degree: 2
  }
}

const relationSelection: ActionInspectorSelection = {
  kind: 'edge',
  edge: {
    id: 'r-1',
    source: 'Elon Musk',
    target: 'Tesla',
    type: 'works_for',
    properties: {
      description: 'Elon Musk works for Tesla',
      keywords: 'works_for'
    },
    dynamicId: 'r-1-d',
    revision_token: 'edge-token-1'
  }
}

describe('ActionInspector', () => {
  beforeEach(() => {
    useGraphWorkbenchStore.getState().reset()
  })

  test('Inspect / Create / Delete / merge 四个 tab 可切换', async () => {
    const { ActionInspector, resolveActionInspectorTab } = await import('./ActionInspector')

    const inspectHtml = renderToString(
      <ActionInspector
        initialTab="inspect"
        selection={nodeSelection as any}
        inspectPane={<div>Inspect Pane</div>}
      />
    )
    expect(inspectHtml).toContain('Inspect Pane')

    const createTab = resolveActionInspectorTab('inspect', 'create')
    const createHtml = renderToString(
      <ActionInspector
        initialTab={createTab}
        selection={nodeSelection as any}
        inspectPane={<div>Inspect Pane</div>}
      />
    )
    expect(createHtml).toContain('Create Node')
    expect(createHtml).toContain('Create Relation')
    expect(createHtml).toContain('Type')
    expect(createHtml).toContain('overflow-y-auto')

    const deleteTab = resolveActionInspectorTab(createTab, 'delete')
    const deleteHtml = renderToString(
      <ActionInspector
        initialTab={deleteTab}
        selection={relationSelection as any}
        inspectPane={<div>Inspect Pane</div>}
      />
    )
    expect(deleteHtml).toContain('Delete Selection')

    const mergeTab = resolveActionInspectorTab(deleteTab, 'merge')
    const mergeHtml = renderToString(
      <ActionInspector
        initialTab={mergeTab}
        selection={relationSelection as any}
        inspectPane={<div>Inspect Pane</div>}
      />
    )
    expect(mergeHtml).toContain('Manual Merge')
    expect(mergeHtml).toContain('Merge Suggestions')
  })

  test('Create Relation 默认草稿为空，不再使用当前选中节点自动预填', async () => {
    const { getDefaultCreateRelationDraft } = await import('./CreateRelationForm')
    const draft = getDefaultCreateRelationDraft()
    expect(draft.sourceEntity).toBe('')
    expect(draft.targetEntity).toBe('')
  })

  test('Create Relation 搜索：空关键词走热门实体，非空关键词走搜索接口', async () => {
    const api = await import('@/api/lightrag')
    const popularSpy = vi.spyOn(api, 'getPopularLabels').mockResolvedValue(['Tesla'])
    const searchSpy = vi.spyOn(api, 'searchLabels').mockResolvedValue(['OpenAI'])

    const { fetchCreateRelationEntityOptions } = await import('./CreateRelationForm')

    expect(await fetchCreateRelationEntityOptions('')).toEqual(['Tesla'])
    expect(await fetchCreateRelationEntityOptions('open')).toEqual(['OpenAI'])
    expect(popularSpy).toHaveBeenCalled()
    expect(searchSpy).toHaveBeenCalledWith('open')
  })

  test('Create Relation 节点点击只填充当前活动字段', async () => {
    const { resolveCreateRelationSelectionFill } = await import('./CreateRelationForm')

    expect(resolveCreateRelationSelectionFill(nodeSelection as any, 'source')).toEqual({
      sourceEntity: 'Elon Musk'
    })
    expect(resolveCreateRelationSelectionFill(nodeSelection as any, 'target')).toEqual({
      targetEntity: 'Elon Musk'
    })
    expect(resolveCreateRelationSelectionFill(nodeSelection as any, null)).toBeNull()
  })

  test('delete confirmation copy 与错误保留', async () => {
    const { buildDeleteConfirmationCopy, reduceDeletePanelStateAfterFailure } = await import(
      './DeleteGraphObjectPanel'
    )
    const copy = buildDeleteConfirmationCopy(relationSelection as any)
    expect(copy).toContain('Elon Musk')
    expect(copy).toContain('Tesla')
    expect(copy).toContain('works_for')

    const next = reduceDeletePanelStateAfterFailure(
      { errorMessage: null },
      'Delete failed'
    )
    expect(next.errorMessage).toBe('Delete failed')
  })

  test('stale-write conflict 会转成显式冲突反馈', () => {
    const conflict = normalizeWorkbenchMutationError(
      new Error('409 Conflict {"detail":"Stale relation revision token"}'),
      'Delete failed'
    )

    expect(conflict.isConflict).toBe(true)
    expect(conflict.message).toContain('Stale revision conflict')
  })

  test('merge: manual source/target entity selection 解析与去重', async () => {
    const { buildManualMergeDraftFromInput } = await import('./MergeEntityPanel')

    const draft = buildManualMergeDraftFromInput(
      ' Elon Msk , Ellon Musk\nElon Msk ',
      'Elon Musk'
    )

    expect(draft.targetEntity).toBe('Elon Musk')
    expect(draft.sourceEntities).toEqual(['Elon Msk', 'Ellon Musk'])
  })

  test('merge: 源实体定位按钮优先定位第一个源实体', async () => {
    const { resolveMergeEntityNavigationValue } = await import('./MergeEntityPanel')

    expect(
      resolveMergeEntityNavigationValue(
        ' Elon Msk , Ellon Musk\nElon Msk ',
        'Elon Musk',
        'source'
      )
    ).toBe('Elon Msk')
    expect(
      resolveMergeEntityNavigationValue(
        ' Elon Msk , Ellon Musk\nElon Msk ',
        'Elon Musk',
        'target'
      )
    ).toBe('Elon Musk')
  })

  test('merge: 定位逻辑会优先聚焦图内节点，否则切换查询实体', async () => {
    const { createMergeEntityNavigationPlan } = await import('./MergeEntityPanel')

    const graphNodePlan = createMergeEntityNavigationPlan(
      {
        getNode: (nodeId: string) =>
          nodeId === 'neo4j-node-1'
            ? {
                id: 'neo4j-node-1',
                labels: ['Tesla'],
                properties: { entity_id: 'Tesla' }
              }
            : null,
        nodes: [
          {
            id: 'neo4j-node-1',
            labels: ['Tesla'],
            properties: { entity_id: 'Tesla' }
          }
        ]
      } as any,
      'Tesla'
    )

    expect(graphNodePlan).toEqual({
      entityName: 'Tesla',
      nodeId: 'neo4j-node-1',
      requiresQueryRefresh: false
    })

    const missingNodePlan = createMergeEntityNavigationPlan(
      {
        getNode: () => null,
        nodes: []
      } as any,
      'OpenAI'
    )

    expect(missingNodePlan).toEqual({
      entityName: 'OpenAI',
      nodeId: null,
      requiresQueryRefresh: true
    })
  })

  test('merge: suggested candidate evidence 可展示', async () => {
    const { buildMergeCandidateEvidence } = await import('./MergeSuggestionList')
    const candidate: GraphMergeSuggestionCandidate = {
      target_entity: 'Elon Musk',
      source_entities: ['Elon Msk', 'Ellon Musk'],
      score: 0.97,
      reasons: [
        { code: 'name_similarity', score: 0.97 },
        { code: 'description_overlap', score: 0.81 }
      ]
    }

    const evidence = buildMergeCandidateEvidence(candidate)
    expect(evidence).toContain('name_similarity')
    expect(evidence).toContain('description_overlap')
    expect(evidence).toContain('0.97')
  })

  test('merge: suggested candidate load 使用 applied scope 构建请求', async () => {
    const { buildMergeSuggestionsRequest } = await import('./MergeEntityPanel')
    const filterDraft = getDefaultGraphWorkbenchFilterDraft()
    const appliedQuery = getDefaultGraphWorkbenchFilterDraft()
    appliedQuery.scope.label = 'Tesla'
    appliedQuery.scope.max_depth = 2
    appliedQuery.scope.max_nodes = 128
    appliedQuery.scope.only_matched_neighborhood = true

    const request = buildMergeSuggestionsRequest(appliedQuery, filterDraft, 12, 0.45, true)
    expect(request.scope.label).toBe('Tesla')
    expect(request.scope.max_depth).toBe(2)
    expect(request.limit).toBe(12)
    expect(request.min_score).toBe(0.45)
    expect(request.use_llm).toBe(true)
  })

  test('merge: llm 回退提示会从 response meta 生成可展示文案', async () => {
    const { resolveMergeSuggestionFallbackNotice } = await import('./MergeEntityPanel')

    const notice = resolveMergeSuggestionFallbackNotice({
      strategy: 'heuristic_v1_fallback',
      requested_limit: 20,
      min_score: 0.6,
      returned_candidates: 2,
      llm_requested: true,
      llm_used: false,
      llm_fallback_reason: 'llm timed out'
    })

    expect(notice).toContain('llm timed out')
  })

  test('merge: one-click candidate import into merge form', async () => {
    const { importMergeCandidate } = useGraphWorkbenchStore.getState()
    const candidate: GraphMergeSuggestionCandidate = {
      target_entity: 'OpenAI',
      source_entities: ['Open AI'],
      score: 0.93,
      reasons: [{ code: 'alias_overlap', score: 0.93 }]
    }

    importMergeCandidate(candidate)
    const state = useGraphWorkbenchStore.getState()
    expect(state.mergeDraft.targetEntity).toBe('OpenAI')
    expect(state.mergeDraft.sourceEntities).toEqual(['Open AI'])
  })

  test('merge: expected revision tokens 会从当前 selection 映射到 merge 请求实体', async () => {
    const { buildExpectedRevisionTokensForMerge } = await import('./MergeEntityPanel')
    const tokens = buildExpectedRevisionTokensForMerge(
      {
        sourceEntities: ['Elon Musk'],
        targetEntity: 'Tesla'
      },
      relationSelection as any
    )

    expect(tokens).toEqual({
      'Elon Musk': 'edge-token-1',
      Tesla: 'edge-token-1'
    })
  })

  test('merge: post-merge 后续动作映射（focus / refresh / continue）', async () => {
    const { resolvePostMergeFollowUp } = await import('./MergeEntityPanel')

    const focus = resolvePostMergeFollowUp('focus_target', 'Elon Musk')
    const refresh = resolvePostMergeFollowUp('refresh_results', 'Elon Musk')
    const continueReview = resolvePostMergeFollowUp('continue_review', 'Elon Musk')

    expect(focus.focusTarget).toBe('Elon Musk')
    expect(focus.shouldRefresh).toBe(false)
    expect(focus.dismissActions).toBe(true)

    expect(refresh.focusTarget).toBeNull()
    expect(refresh.shouldRefresh).toBe(true)
    expect(refresh.dismissActions).toBe(true)

    expect(continueReview.focusTarget).toBeNull()
    expect(continueReview.shouldRefresh).toBe(false)
    expect(continueReview.dismissActions).toBe(true)
  })

  test('merge: follow-up 提示会在超时后自动关闭', async () => {
    const { shouldAutoDismissMergeFollowUp } = await import('./MergeEntityPanel')

    expect(
      shouldAutoDismissMergeFollowUp({
        targetEntity: 'Tesla',
        sourceEntities: ['Tesla Motors'],
        mergedAt: 1000
      }, 1000 + 7999)
    ).toBe(false)

    expect(
      shouldAutoDismissMergeFollowUp({
        targetEntity: 'Tesla',
        sourceEntities: ['Tesla Motors'],
        mergedAt: 1000
      }, 1000 + 8000)
    ).toBe(true)
  })

  test('create relation: 窄布局下使用单列，较宽时再切双列，避免控件重叠', async () => {
    const module = await import('./CreateRelationForm')
    const CreateRelationForm = module.default

    const html = renderToString(<CreateRelationForm selection={relationSelection as any} />)

    expect(html).toContain('w-full')
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('sm:grid-cols-2')
  })

  test('delete: 二次确认弹窗会展示待删除对象的关键信息', async () => {
    const { buildDeleteDialogDetails } = await import('./DeleteGraphObjectPanel')

    const nodeDetails = buildDeleteDialogDetails(nodeSelection as any)
    expect(nodeDetails.title).toContain('Elon Musk')
    expect(nodeDetails.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'Elon Musk' }),
        expect.objectContaining({ value: 'CEO' })
      ])
    )

    const relationDetails = buildDeleteDialogDetails(relationSelection as any)
    expect(relationDetails.title).toContain('Elon Musk')
    expect(relationDetails.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'Elon Musk' }),
        expect.objectContaining({ value: 'Tesla' }),
        expect.objectContaining({ value: 'works_for' })
      ])
    )
  })
})
