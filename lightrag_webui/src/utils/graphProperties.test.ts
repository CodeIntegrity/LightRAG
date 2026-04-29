import { describe, expect, test } from 'bun:test'

import {
  getVisibleGraphPropertyEntries,
  getVisibleGraphPropertyKeys,
  isEmptyGraphPropertyValue
} from './graphProperties'

describe('graphProperties', () => {
  test('识别空属性值', () => {
    expect(isEmptyGraphPropertyValue('')).toBe(true)
    expect(isEmptyGraphPropertyValue('   ')).toBe(true)
    expect(isEmptyGraphPropertyValue(null)).toBe(true)
    expect(isEmptyGraphPropertyValue(undefined)).toBe(true)
    expect(isEmptyGraphPropertyValue('value')).toBe(false)
  })

  test('节点属性过滤空值、内部字段和重复 name', () => {
    expect(
      getVisibleGraphPropertyKeys(
        {
          entity_id: 'node-1',
          name: 'Display Name',
          entity_type: 'concept',
          description: '',
          file_path: 'doc/a.md',
          truncate: 'FIFO 1/2',
          created_at: '123',
          keywords: 'k1'
        },
        'node'
      )
    ).toEqual(['entity_id', 'entity_type', 'file_path', 'keywords'])
  })

  test('边属性过滤空值和内部字段', () => {
    expect(
      getVisibleGraphPropertyKeys(
        {
          keywords: '',
          description: 'edge-desc',
          created_at: 123,
          revision_token: 'token-1',
          graph_data: { description: 'edge-desc' },
          truncate: 'KEEP 1/2',
          weight: 1
        },
        'edge'
      )
    ).toEqual(['description', 'weight'])
  })

  test('边属性在显示关系名称时隐藏重复 keywords', () => {
    expect(
      getVisibleGraphPropertyKeys(
        {
          keywords: 'rel-keywords',
          description: 'edge-desc',
          weight: 1
        },
        'edge',
        { hideKeywords: true }
      )
    ).toEqual(['description', 'weight'])
  })

  test('展开 custom_properties 为独立属性项', () => {
    expect(
      getVisibleGraphPropertyEntries(
        {
          entity_id: 'node-1',
          entity_type: 'concept',
          custom_properties: {
            aliases: ['A', 'B'],
            metadata: {
              rank: 1
            }
          }
        },
        'node'
      )
    ).toEqual([
      { name: 'entity_id', value: 'node-1' },
      { name: 'entity_type', value: 'concept' },
      { name: 'aliases', value: ['A', 'B'] },
      { name: 'metadata', value: { rank: 1 } }
    ])
  })

  test('节点属性展开时隐藏 custom_properties 里的重复 name', () => {
    expect(
      getVisibleGraphPropertyEntries(
        {
          entity_id: 'node-1',
          custom_properties: {
            name: 'Display Name',
            aliases: ['A', 'B']
          }
        },
        'node'
      )
    ).toEqual([
      { name: 'entity_id', value: 'node-1' },
      { name: 'aliases', value: ['A', 'B'] }
    ])
  })

  test('节点属性过滤内部包装字段', () => {
    expect(
      getVisibleGraphPropertyKeys(
        {
          entity_id: 'node-1',
          revision_token: 'token-1',
          graph_data: {
            entity_id: 'node-1'
          },
          description: 'node-desc'
        },
        'node'
      )
    ).toEqual(['description', 'entity_id'])
  })
})
