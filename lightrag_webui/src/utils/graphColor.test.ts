import { describe, expect, test } from 'bun:test'

import { resolveNodeColor, getCommunityColor } from './graphColor'

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

describe('getCommunityColor', () => {
  const HEX = /^#[0-9a-f]{6}$/

  test('返回合法的 6 位 hex 颜色', () => {
    expect(getCommunityColor(0)).toMatch(HEX)
    expect(getCommunityColor(7)).toMatch(HEX)
    expect(getCommunityColor(42)).toMatch(HEX)
  })

  test('同一社区 id 颜色稳定', () => {
    expect(getCommunityColor(3)).toBe(getCommunityColor(3))
  })

  test('相邻社区颜色不同（黄金角拉开色相）', () => {
    expect(getCommunityColor(0)).not.toBe(getCommunityColor(1))
    expect(getCommunityColor(1)).not.toBe(getCommunityColor(2))
  })

  test('非有限/负数输入不崩溃且仍返回合法 hex', () => {
    expect(getCommunityColor(-5)).toMatch(HEX)
    expect(getCommunityColor(NaN)).toMatch(HEX)
    expect(getCommunityColor(1.9)).toMatch(HEX)
  })
})
