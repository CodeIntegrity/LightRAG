import { describe, expect, test } from 'bun:test'

import { resolveNodeColor } from './graphColor'

describe('resolveNodeColor', () => {
  test('中文类型保留原始值作为图例标签，不映射成英文', () => {
    const { color, map } = resolveNodeColor('组织', undefined)

    // 图例标签必须是数据库真实值，而非同义词归一化后的英文
    expect(map.has('组织')).toBe(true)
    expect(map.has('organization')).toBe(false)
    // 颜色仍按语义分组（organization 绿色）
    expect(color).toBe('#00cc00')
  })

  test('同义类型保留各自原始值，但共享同一颜色', () => {
    const first = resolveNodeColor('组织', undefined)
    const second = resolveNodeColor('公司', first.map)

    expect(second.map.has('组织')).toBe(true)
    expect(second.map.has('公司')).toBe(true)
    expect(second.color).toBe(first.color) // 同属 organization，颜色一致
  })

  test('英文类型保留原始大小写', () => {
    const { color, map } = resolveNodeColor('PERSON', undefined)

    expect(map.has('PERSON')).toBe(true)
    expect(map.has('person')).toBe(false)
    expect(color).toBe('#4169E1')
  })

  test('非同义词类型直接使用原始值', () => {
    const { map } = resolveNodeColor('资产', undefined)

    expect(map.has('资产')).toBe(true)
  })

  test('空类型回退为 unknown', () => {
    const { map } = resolveNodeColor(undefined, undefined)

    expect(map.has('unknown')).toBe(true)
  })
})
