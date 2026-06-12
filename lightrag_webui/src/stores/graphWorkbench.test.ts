import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getDefaultGraphWorkbenchFilterDraft,
  useGraphWorkbenchStore
} from './graphWorkbench'
import { useSettingsStore } from './settings'

describe('graphWorkbench store', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      graphMaxNodes: 1000,
      backendMaxGraphNodes: null
    })
    useGraphWorkbenchStore.getState().reset()
  })

  test('维护 filter draft 与 applied query 的分离状态', () => {
    const store = useGraphWorkbenchStore.getState()
    const draft = getDefaultGraphWorkbenchFilterDraft()
    const beforeVersion = useGraphWorkbenchStore.getState().queryVersion

    draft.scope.label = 'Tesla'
    draft.scope.max_depth = 2
    draft.scope.max_nodes = 200
    draft.node_filters.entity_types = ['ORGANIZATION']

    store.setFilterDraft(draft)
    expect(useGraphWorkbenchStore.getState().appliedQuery).toBeNull()

    store.applyFilterDraft()
    const applied = useGraphWorkbenchStore.getState().appliedQuery
    expect(applied).not.toBeNull()
    expect(applied?.scope.label).toBe('Tesla')
    expect(applied?.scope.max_depth).toBe(2)
    expect(applied?.node_filters.entity_types).toEqual(['ORGANIZATION'])
    expect(useGraphWorkbenchStore.getState().queryVersion).toBe(beforeVersion + 1)
  })

  test('维护 merge candidate 列表与选择队列', () => {
    const store = useGraphWorkbenchStore.getState()
    const candidates = [
      {
        target_entity: 'Elon Musk',
        source_entities: ['Elon Msk'],
        score: 0.95,
        reasons: [{ code: 'name_similarity', score: 0.95 }]
      },
      {
        target_entity: 'OpenAI',
        source_entities: ['Open AI'],
        score: 0.91,
        reasons: [{ code: 'alias_overlap', score: 0.91 }]
      }
    ]

    store.setMergeCandidates(candidates)
    store.selectMergeCandidate('Elon Musk')
    store.selectMergeCandidate('OpenAI')

    expect(useGraphWorkbenchStore.getState().selectedMergeCandidateTargets).toEqual([
      'Elon Musk',
      'OpenAI'
    ])

    store.clearSelection()
    expect(useGraphWorkbenchStore.getState().selectedMergeCandidateTargets).toEqual([])
  })

  test('applyScopeLabel 会直接更新 applied query 并递增 refetch version', () => {
    const store = useGraphWorkbenchStore.getState()
    const beforeVersion = useGraphWorkbenchStore.getState().queryVersion

    store.applyScopeLabel('OpenAI')

    const state = useGraphWorkbenchStore.getState()
    expect(state.filterDraft.scope.label).toBe('OpenAI')
    expect(state.appliedQuery?.scope.label).toBe('OpenAI')
    expect(state.queryVersion).toBe(beforeVersion + 1)
  })

  test('同步后端最大节点数时只更新默认 scope', () => {
    const store = useGraphWorkbenchStore.getState()

    expect(useGraphWorkbenchStore.getState().filterDraft.scope.max_nodes).toBe(1000)

    store.syncDefaultMaxNodes(2048, 1000)
    expect(useGraphWorkbenchStore.getState().filterDraft.scope.max_nodes).toBe(2048)

    const customDraft = getDefaultGraphWorkbenchFilterDraft()
    customDraft.scope.max_nodes = 300
    store.setFilterDraft(customDraft)

    store.syncDefaultMaxNodes(4096, 2048)
    expect(useGraphWorkbenchStore.getState().filterDraft.scope.max_nodes).toBe(300)
  })

  test('值未变化时 syncDefaultMaxNodes 保持引用稳定（避免健康检查每 15 秒触发整图重载）', () => {
    const store = useGraphWorkbenchStore.getState()

    // 模拟用户在过滤工作台点过“应用”，appliedQuery 变为非 null
    store.applyFilterDraft()

    const before = useGraphWorkbenchStore.getState()
    const appliedBefore = before.appliedQuery
    const draftBefore = before.filterDraft
    const stableMaxNodes = appliedBefore?.scope.max_nodes ?? 1000

    // 健康检查稳定态：后端限制未变，maxNodes === previousMaxNodes
    store.syncDefaultMaxNodes(stableMaxNodes, stableMaxNodes)

    const after = useGraphWorkbenchStore.getState()
    // 值相同的同步必须是 no-op：引用保持不变。否则 useLightragGraph 订阅的
    // appliedQuery 会被 Object.is 判定为“变化”，导致每次健康检查都重载整图
    expect(after.appliedQuery).toBe(appliedBefore)
    expect(after.filterDraft).toBe(draftBefore)
  })

  test('维护 mutationError 与 conflictError 状态', () => {
    const store = useGraphWorkbenchStore.getState()

    store.setMutationError('删除失败', true)
    expect(useGraphWorkbenchStore.getState().mutationError).toBe('删除失败')
    expect(useGraphWorkbenchStore.getState().conflictError).toBe('删除失败')

    store.clearMutationError()
    expect(useGraphWorkbenchStore.getState().mutationError).toBeNull()
    expect(useGraphWorkbenchStore.getState().conflictError).toBeNull()
  })

  test('requestRefresh 可触发 refetch version 递增', () => {
    const store = useGraphWorkbenchStore.getState()
    const before = useGraphWorkbenchStore.getState().queryVersion

    store.requestRefresh()

    expect(useGraphWorkbenchStore.getState().queryVersion).toBe(before + 1)
  })

  test('默认 inspect 优先，且仅 scope 分组默认展开', () => {
    const state = useGraphWorkbenchStore.getState()

    expect(state.activeActionMode).toBe('inspect')
    expect(state.filterSections).toEqual({
      scope: true,
      node: false,
      edge: false,
      source: false,
      view: false
    })
  })
})
