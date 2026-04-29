import { describe, expect, test } from 'vitest'
import MiniSearch from 'minisearch'
import {
  limitGraphSearchOptions,
  mapRemoteLabelsToOptions,
  mergeGraphSearchOptions,
  resolveGraphSearchSelection,
  searchLocalGraphNodes
} from './graphSearch'

const createMockGraph = () => {
  const nodes = new Map<string, { label: string }>([
    ['n1', { label: 'OpenAI' }],
    ['n2', { label: 'Anthropic Labs' }],
    ['n3', { label: 'Research Lab' }]
  ])

  return {
    hasNode: (id: string) => nodes.has(id),
    nodes: () => Array.from(nodes.keys()),
    getNodeAttribute: (id: string, attribute: string) => {
      if (attribute !== 'label') {
        return undefined
      }
      return nodes.get(id)?.label
    }
  }
}

const createMockRawGraph = () => ({
  getNode: (nodeId: string) => (nodeId === 'n1' ? { id: 'n1' } : undefined),
  nodes: [
    {
      id: 'n1',
      properties: {
        entity_id: 'OpenAI'
      }
    }
  ]
})

describe('graphSearch utils', () => {
  test('本地图搜索支持中段匹配', () => {
    const graph = createMockGraph()
    const searchEngine = new MiniSearch<{ id: string; label: string }>({
      idField: 'id',
      fields: ['label'],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2
      }
    })
    searchEngine.addAll(
      graph.nodes().map((id) => ({
        id,
        label: String(graph.getNodeAttribute(id, 'label') || id)
      }))
    )

    const results = searchLocalGraphNodes(graph, searchEngine, 'lab', 10)
    expect(results.map((item) => item.id)).toEqual(expect.arrayContaining(['n2', 'n3']))
    expect(results).toHaveLength(2)
  })

  test('远端 label 结果会优先映射到当前图内节点', () => {
    const results = mapRemoteLabelsToOptions(['OpenAI', 'DeepMind'], createMockRawGraph())

    expect(results).toEqual([
      {
        value: 'node:n1',
        id: 'n1',
        type: 'nodes',
        label: 'OpenAI'
      },
      {
        value: 'label:DeepMind',
        id: 'DeepMind',
        type: 'labels',
        label: 'DeepMind'
      }
    ])
  })

  test('合并结果按 value 去重并保留顺序', () => {
    const results = mergeGraphSearchOptions(
      [
        { value: 'node:n1', id: 'n1', type: 'nodes', label: 'OpenAI' },
        { value: 'node:n2', id: 'n2', type: 'nodes', label: 'Anthropic Labs' }
      ],
      [
        { value: 'node:n1', id: 'n1', type: 'nodes', label: 'OpenAI' },
        { value: 'label:DeepMind', id: 'DeepMind', type: 'labels', label: 'DeepMind' }
      ]
    )

    expect(results.map((item) => item.value)).toEqual(['node:n1', 'node:n2', 'label:DeepMind'])
  })

  test('选择远端 label 时可识别是否需要强制刷新', () => {
    expect(
      resolveGraphSearchSelection(
        { value: 'label:OpenAI', id: 'OpenAI', type: 'labels', label: 'OpenAI' },
        'OpenAI'
      )
    ).toEqual({
      kind: 'query-label',
      label: 'OpenAI',
      forceRefresh: true
    })

    expect(
      resolveGraphSearchSelection(
        { value: 'node:n1', id: 'n1', type: 'nodes', label: 'OpenAI' },
        'OpenAI'
      )
    ).toEqual({
      kind: 'select-node',
      nodeId: 'n1'
    })
  })

  test('超出上限时追加提示项', () => {
    const results = limitGraphSearchOptions(
      [
        { value: 'node:n1', id: 'n1', type: 'nodes', label: 'OpenAI' },
        { value: 'node:n2', id: 'n2', type: 'nodes', label: 'Anthropic Labs' }
      ],
      1,
      '1 more'
    )

    expect(results).toEqual([
      { value: 'node:n1', id: 'n1', type: 'nodes', label: 'OpenAI' },
      { value: '__message_item', id: '__message_item', type: 'message', message: '1 more' }
    ])
  })
})
