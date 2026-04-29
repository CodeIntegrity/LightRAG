import { describe, expect, test } from 'bun:test'

import { resolveNodeDisplayName } from './graphLabel'

describe('resolveNodeDisplayName', () => {
  test('优先使用顶层 name', () => {
    expect(
      resolveNodeDisplayName({
        id: 'node-1',
        name: 'Top Level Name',
        labels: ['entity-id'],
        properties: {
          name: 'Nested Name',
          entity_id: 'entity-id'
        }
      })
    ).toBe('Top Level Name')
  })

  test('优先使用 properties.name', () => {
    expect(
      resolveNodeDisplayName({
        id: 'node-1',
        labels: ['entity-id'],
        properties: {
          name: 'Display Name',
          entity_id: 'entity-id'
        }
      })
    ).toBe('Display Name')
  })

  test('缺少显式 name 时回退到 custom_properties.name', () => {
    expect(
      resolveNodeDisplayName({
        id: 'node-1',
        labels: ['entity-id'],
        properties: {
          entity_id: 'entity-id',
          custom_properties: {
            name: 'Custom Name'
          }
        }
      })
    ).toBe('Custom Name')
  })

  test('缺少 name 时回退到 entity_id', () => {
    expect(
      resolveNodeDisplayName({
        id: 'node-1',
        labels: ['entity-id'],
        properties: {
          entity_id: 'entity-id'
        }
      })
    ).toBe('entity-id')
  })

  test('缺少 name 和 entity_id 时回退到首个 label', () => {
    expect(
      resolveNodeDisplayName({
        id: 'node-1',
        labels: ['label-a', 'label-b'],
        properties: {}
      })
    ).toBe('label-a')
  })

  test('最后回退到 id', () => {
    expect(
      resolveNodeDisplayName({
        id: 'node-1',
        labels: [],
        properties: {}
      })
    ).toBe('node-1')
  })
})
