import { describe, expect, test } from 'bun:test'

import { normalizeGraphEdgePayload, normalizeGraphNodePayload } from './graphPayload'

describe('graphPayload', () => {
  test('节点归一化时合并顶层 name 与 custom_properties', () => {
    expect(
      normalizeGraphNodePayload({
        id: 'node-1',
        labels: ['concept'],
        name: 'Top Level Name',
        properties: {
          entity_id: 'entity-1',
          custom_properties: {
            aliases: ['A']
          }
        },
        custom_properties: {
          score: 0.9
        }
      }).properties
    ).toEqual({
      entity_id: 'entity-1',
      name: 'Top Level Name',
      custom_properties: {
        aliases: ['A'],
        score: 0.9
      }
    })
  })

  test('边归一化时保留结构字段并合并顶层 custom_properties', () => {
    expect(
      normalizeGraphEdgePayload({
        id: 'edge-1',
        source: 'a',
        target: 'b',
        type: 'related',
        weight: 2,
        properties: {
          description: 'edge'
        },
        custom_properties: {
          source_doc: 'doc-1'
        }
      }).properties
    ).toEqual({
      description: 'edge',
      weight: 2,
      custom_properties: {
        source_doc: 'doc-1'
      }
    })
  })

  test('归一化时不把内部字段混入 properties', () => {
    expect(
      normalizeGraphNodePayload({
        id: 'node-1',
        labels: ['concept'],
        graph_data: {
          entity_id: 'entity-1'
        },
        revision_token: 'token-1',
        properties: {
          entity_id: 'entity-1'
        }
      }).properties
    ).toEqual({
      entity_id: 'entity-1'
    })
  })

  test('归一化时解析字符串形式的 custom_properties', () => {
    expect(
      normalizeGraphNodePayload({
        id: 'node-1',
        labels: ['concept'],
        properties: {
          entity_id: 'entity-1',
          custom_properties: '{"region":"cn","score":0.9}'
        }
      }).properties
    ).toEqual({
      entity_id: 'entity-1',
      custom_properties: {
        region: 'cn',
        score: 0.9
      }
    })
  })
})
