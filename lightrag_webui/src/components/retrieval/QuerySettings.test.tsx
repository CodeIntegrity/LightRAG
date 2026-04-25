import { describe, expect, test } from 'vitest'

import {
  applyQuerySettingsDependencies,
  normalizeNumericDraft,
  numericQuerySettingDefaults
} from './QuerySettings'

const baseSettings = {
  mode: 'mix' as const,
  top_k: numericQuerySettingDefaults.top_k,
  chunk_top_k: numericQuerySettingDefaults.chunk_top_k,
  max_entity_tokens: numericQuerySettingDefaults.max_entity_tokens,
  max_relation_tokens: numericQuerySettingDefaults.max_relation_tokens,
  max_total_tokens: numericQuerySettingDefaults.max_total_tokens,
  history_turns: numericQuerySettingDefaults.history_turns,
  only_need_context: false,
  only_need_prompt: false,
  stream: true,
  enable_rerank: true,
  include_references: true,
  include_chunk_content: false,
  user_prompt: '',
  prompt_overrides: undefined
}

describe('QuerySettings helpers', () => {
  test('normalizes blank and invalid numeric drafts back to defaults', () => {
    expect(normalizeNumericDraft('', 40, 1)).toBe(40)
    expect(normalizeNumericDraft('abc', 20, 1)).toBe(20)
  })

  test('clips numeric drafts to the field minimum', () => {
    expect(normalizeNumericDraft('0', 40, 1)).toBe(1)
    expect(normalizeNumericDraft('-1', 0, 0)).toBe(0)
  })

  test('turning on only_need_context disables prompt-only and stream mode', () => {
    expect(
      applyQuerySettingsDependencies(baseSettings, {
        only_need_context: true
      })
    ).toMatchObject({
      only_need_context: true,
      only_need_prompt: false,
      stream: false
    })
  })

  test('turning on only_need_prompt disables context-only and stream mode', () => {
    expect(
      applyQuerySettingsDependencies(baseSettings, {
        only_need_prompt: true
      })
    ).toMatchObject({
      only_need_prompt: true,
      only_need_context: false,
      stream: false
    })
  })

  test('chunk content depends on references being enabled', () => {
    expect(
      applyQuerySettingsDependencies(baseSettings, {
        include_references: false
      })
    ).toMatchObject({
      include_references: false,
      include_chunk_content: false
    })

    expect(
      applyQuerySettingsDependencies(
        {
          ...baseSettings,
          include_references: false
        },
        {
          include_chunk_content: true
        }
      )
    ).toMatchObject({
      include_chunk_content: true,
      include_references: true
    })
  })
})
