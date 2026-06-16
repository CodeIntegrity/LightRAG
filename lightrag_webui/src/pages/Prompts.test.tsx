import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import type {
  EntityTypePromptFile,
  EntityTypePromptListResponse,
  EntityTypePromptReadResponse,
  EntityTypePromptSaveResponse,
  EntityTypePromptValidation
} from '@/api/lightrag'
import { createLightragApiMock } from '@/test/apiMock'
import { presetPrompts } from '../features/promptPresets'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key
  })
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@/api/lightrag', () => createLightragApiMock())

vi.mock('@/components/ui/YamlEditor', () => ({
  default: ({
    value,
    placeholder,
    className,
    readOnly
  }: {
    value: string
    placeholder?: string
    className?: string
    readOnly?: boolean
  }) =>
    createElement(
      'div',
      { className, 'data-readonly': readOnly ? 'true' : 'false' },
      createElement('textarea', { value, placeholder, readOnly: true })
    )
}))

const workspaceFile = (overrides: Partial<EntityTypePromptFile> = {}): EntityTypePromptFile => ({
  file_name: 'default--entity-type--v1.yml',
  workspace: 'default',
  prompt_slug: 'entity-type',
  version: 1,
  active: false,
  source: 'workspace',
  updated_at: '2026-05-23T00:00:00Z',
  size_bytes: 120,
  ...overrides
})

describe('Preset prompts', () => {
  test('preset array is non-empty and has valid structure', () => {
    expect(presetPrompts.length).toBeGreaterThan(0)
    const preset = presetPrompts[0]
    expect(preset.id).toBe('general-knowledge-graph')
    expect(preset.name).toBeTruthy()
    expect(preset.description).toBeTruthy()
    expect(preset.content).toContain('entity_types_guidance')
    expect(preset.content).toContain('entity_extraction_examples')
    expect(preset.content).toContain('entity_extraction_json_examples')
    expect(preset.content).toContain('{tuple_delimiter}')
    expect(preset.content).toContain('{completion_delimiter}')
  })

  test('preset content contains Chinese entity type definitions', () => {
    const preset = presetPrompts[0]
    expect(preset.content).toContain('人类个体')
    expect(preset.content).toContain('公司、机构、政府组织')
    expect(preset.content).toContain('地理场所')
    expect(preset.content).toContain('抽象概念')
    expect(preset.content).toContain('流程、技术、算法')
    expect(preset.content).toContain('自然非生物对象')
  })
})

describe('Prompts page state', () => {
  test('loads list and reads the active prompt first', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')
    const files = [
      workspaceFile({ file_name: 'default--entity-type--v1.yml', active: true }),
      workspaceFile({
        file_name: 'foo.yml',
        prompt_slug: 'foo',
        version: 0,
        source: 'global'
      })
    ]

    ;(api.listEntityTypePrompts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspace: 'default',
      active_file: 'default--entity-type--v1.yml',
      files
    } satisfies EntityTypePromptListResponse)
    ;(api.readEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      file_name: 'default--entity-type--v1.yml',
      content: 'entity_types_guidance: test\n',
      profile: {},
      validation: { valid: true, errors: [] }
    } satisfies EntityTypePromptReadResponse)

    const state = await page.loadPromptEditorState('workspace-a')

    expect(api.listEntityTypePrompts).toHaveBeenCalledTimes(1)
    expect(api.readEntityTypePrompt).toHaveBeenCalledWith('default--entity-type--v1.yml')
    expect(state.workspaceKey).toBe('workspace-a')
    expect(state.selectedFileName).toBe('default--entity-type--v1.yml')
    expect(state.content).toContain('entity_types_guidance')
    expect(state.validation.valid).toBe(true)
  })

  test('returns empty state with null selection when no files exist', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')

    ;(api.listEntityTypePrompts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspace: 'default',
      active_file: null,
      files: []
    } satisfies EntityTypePromptListResponse)

    const state = await page.loadPromptEditorState('workspace-a')

    expect(state.selectedFileName).toBeNull()
    expect(state.content).toBe('')
    expect(state.list.files).toHaveLength(0)
  })

  test('selects validates saves activates and reloads when workspace changes', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')
    const baseState = page.createPromptEditorState({
      workspaceKey: 'workspace-a',
      list: {
        workspace: 'default',
        active_file: null,
        files: [workspaceFile()]
      },
      selectedFileName: null,
      content: '',
      validation: { valid: false, errors: [] }
    })

    ;(api.readEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      file_name: 'default--entity-type--v1.yml',
      content: 'entity_types_guidance: selected\n',
      profile: {},
      validation: { valid: true, errors: [] }
    } satisfies EntityTypePromptReadResponse)

    const selected = await page.selectPromptFile(baseState, 'default--entity-type--v1.yml')

    expect(api.readEntityTypePrompt).toHaveBeenCalledWith('default--entity-type--v1.yml')
    expect(selected.selectedFileName).toBe('default--entity-type--v1.yml')

    ;(api.validateEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      valid: true,
      errors: []
    } satisfies EntityTypePromptValidation)

    const validated = await page.validatePromptContent(selected)

    expect(api.validateEntityTypePrompt).toHaveBeenCalledWith({
      content: 'entity_types_guidance: selected\n'
    })
    expect(validated.validation.valid).toBe(true)

    ;(api.saveEntityTypePromptVersion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: workspaceFile({
        file_name: 'default--entity-type--v2.yml',
        version: 2,
        active: true
      }),
      validation: { valid: true, errors: [] },
      active_file: 'default--entity-type--v2.yml'
    } satisfies EntityTypePromptSaveResponse)

    const saved = await page.savePromptVersion(validated, {
      promptSlug: 'entity-type',
      version: 2,
      activate: true
    })

    expect(api.saveEntityTypePromptVersion).toHaveBeenCalledWith('entity-type', 2, {
      content: 'entity_types_guidance: selected\n',
      activate: true
    })
    expect(saved.selectedFileName).toBe('default--entity-type--v2.yml')
    expect(saved.list.active_file).toBe('default--entity-type--v2.yml')

    ;(api.activateEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      active_file: 'default--entity-type--v2.yml',
      file: workspaceFile({
        file_name: 'default--entity-type--v2.yml',
        version: 2,
        active: true
      }),
      validation: { valid: true, errors: [] }
    })

    const activated = await page.activateSelectedPrompt(saved)

    expect(api.activateEntityTypePrompt).toHaveBeenCalledWith('default--entity-type--v2.yml')
    expect(activated.list.active_file).toBe('default--entity-type--v2.yml')

    expect(page.shouldReloadPromptEditor(activated, 'workspace-b')).toBe(true)
    expect(page.shouldReloadPromptEditor(activated, 'workspace-a')).toBe(false)
  })

  test('deletePromptFile removes the file and clears selection only when it was selected', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')
    ;(api.deleteEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      deleted_file: 'default--entity-type--v2.yml',
      active_file: 'default--entity-type--v1.yml'
    })

    const baseState = page.createPromptEditorState({
      workspaceKey: 'workspace-a',
      list: {
        workspace: 'default',
        active_file: 'default--entity-type--v1.yml',
        files: [
          workspaceFile({ active: true }),
          workspaceFile({ file_name: 'default--entity-type--v2.yml', version: 2 })
        ]
      },
      selectedFileName: 'default--entity-type--v2.yml',
      content: 'draft',
      validation: { valid: true, errors: [] }
    })

    const { state: afterDelete, wasSelected } = await page.deletePromptFile(
      baseState,
      'default--entity-type--v2.yml'
    )

    expect(api.deleteEntityTypePrompt).toHaveBeenCalledWith('default--entity-type--v2.yml')
    expect(wasSelected).toBe(true)
    expect(afterDelete.list.files.map((f) => f.file_name)).toEqual([
      'default--entity-type--v1.yml'
    ])
    expect(afterDelete.selectedFileName).toBeNull()

    // Deleting a non-selected file keeps the current selection intact.
    const { state: afterOther, wasSelected: other } = await page.deletePromptFile(
      { ...baseState, selectedFileName: 'default--entity-type--v1.yml' },
      'default--entity-type--v2.yml'
    )
    expect(other).toBe(false)
    expect(afterOther.selectedFileName).toBe('default--entity-type--v1.yml')
  })

  test('formats prompt files with logical fields instead of real file names', async () => {
    const page = await import('./Prompts')
    const file = workspaceFile()

    expect(page.formatPromptFileTitle(file)).toBe('entity-type')
    expect(page.formatPromptFileMeta(file)).toContain('v1')
    expect(page.formatPromptFileMeta(file)).toContain('workspace')
    expect(page.formatPromptFileMeta(file)).toContain('2026-05-23T00:00:00Z')
    expect(page.formatPromptFileMeta(file)).not.toContain(file.file_name)
  })
})

describe('Prompts page shell', () => {
  test('renders preset list, editor and action controls', async () => {
    const page = await import('./Prompts')
    const html = renderToStaticMarkup(createElement(page.default))

    expect(html).toContain('Prompts')
    expect(html).toContain('Presets')
    expect(html).toContain('No prompt files')
    expect(html).toContain('Prompt slug')
    expect(html).toContain('Version')
    expect(html).toContain('Save')
    expect(html).toContain('Activate')
    expect(html).toContain('Load from preset')
    expect(html).toContain('New blank')
    expect(html).toContain('Refresh')
  })
})

describe('PromptEditorState creations', () => {
  test('chooseInitialFile returns null when files list is empty', async () => {
    const page = await import('./Prompts')
    const result = page.chooseInitialFile({ workspace: 'default', active_file: null, files: [] })
    expect(result).toBeNull()
  })

  test('chooseInitialFile returns active file when available', async () => {
    const page = await import('./Prompts')
    const activeFile = workspaceFile({ file_name: 'active.yml', active: true })
    const result = page.chooseInitialFile({
      workspace: 'default',
      active_file: 'active.yml',
      files: [workspaceFile({ file_name: 'other.yml' }), activeFile]
    })
    expect(result?.file_name).toBe('active.yml')
  })
})

describe('Prompts assist draft', () => {
  test('generateAssistDraft posts only provided fields and returns full response', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')

    ;(api.assistEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'entity_types_guidance: drafted\n',
      validation: { valid: true, errors: [] },
      warnings: [],
      raw_output: 'entity_types_guidance: drafted\n',
      model: 'role-query-model'
    })

    const result = await page.generateAssistDraft({
      requirements: 'medical',
      currentContent: 'entity_types_guidance: prior\n'
    })

    expect(api.assistEntityTypePrompt).toHaveBeenCalledWith({
      requirements: 'medical',
      current_content: 'entity_types_guidance: prior\n'
    })
    // Response shape is forwarded unchanged for the UI to inspect.
    expect(result.content).toBe('entity_types_guidance: drafted\n')
    expect(result.raw_output).toBe('entity_types_guidance: drafted\n')
    expect(result.model).toBe('role-query-model')
    expect(result.validation.valid).toBe(true)
  })

  test('generateAssistDraft omits current_content when blank', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')

    ;(api.assistEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: '',
      validation: { valid: false, errors: ['empty'] },
      warnings: [],
      raw_output: '',
      model: null
    })

    await page.generateAssistDraft({ requirements: 'minimal', currentContent: '' })

    expect(api.assistEntityTypePrompt).toHaveBeenCalledWith({
      requirements: 'minimal'
    })
  })

  test('applyAssistDraft replaces content and resets validation to draft validation', async () => {
    const page = await import('./Prompts')
    const baseState = page.createPromptEditorState({
      workspaceKey: 'workspace-a',
      content: 'original',
      validation: { valid: true, errors: [] }
    })

    const next = page.applyAssistDraft(baseState, {
      content: 'drafted yaml',
      validation: { valid: false, errors: ['draft issue'] },
      warnings: [],
      raw_output: 'drafted yaml',
      model: 'm'
    })

    expect(next.content).toBe('drafted yaml')
    expect(next.validation).toEqual({ valid: false, errors: ['draft issue'] })
    // Apply must not touch list state.
    expect(next.list).toEqual(baseState.list)
  })

  test('revertAssistTurns truncates the conversation to the chosen turn (inclusive)', async () => {
    const page = await import('./Prompts')
    const turn = (content: string) => ({
      instruction: content,
      response: {
        content,
        validation: { valid: true, errors: [] },
        warnings: [],
        raw_output: content,
        model: 'm'
      }
    })
    const turns = [turn('v1'), turn('v2'), turn('v3')]

    // Reverting to index 0 keeps only the first turn.
    expect(page.revertAssistTurns(turns, 0)).toEqual([turns[0]])
    // Reverting to the last index is a no-op.
    expect(page.revertAssistTurns(turns, 2)).toEqual(turns)
    // Out-of-range index is clamped to the full prefix (safe).
    expect(page.revertAssistTurns(turns, 99)).toEqual(turns)
  })

  test('shouldConfirmAssistApply triggers on unsaved changes OR invalid draft', async () => {
    const page = await import('./Prompts')

    // No unsaved changes + valid draft → no confirm needed.
    expect(
      page.shouldConfirmAssistApply({
        hasUnsavedChanges: false,
        draftValidationValid: true
      })
    ).toBe(false)

    // Unsaved changes alone → confirm.
    expect(
      page.shouldConfirmAssistApply({
        hasUnsavedChanges: true,
        draftValidationValid: true
      })
    ).toBe(true)

    // Invalid draft alone → confirm.
    expect(
      page.shouldConfirmAssistApply({
        hasUnsavedChanges: false,
        draftValidationValid: false
      })
    ).toBe(true)

    // Both → still a single confirm decision (not two).
    expect(
      page.shouldConfirmAssistApply({
        hasUnsavedChanges: true,
        draftValidationValid: false
      })
    ).toBe(true)
  })

  test('Prompts page renders the Assist button in the toolbar', async () => {
    const page = await import('./Prompts')
    const html = renderToStaticMarkup(createElement(page.default))

    // Assist button label is taken from the i18n fallback ("Assist").
    expect(html).toContain('Assist')
    // The collapsible panel is hidden by default; aria-expanded must reflect
    // the closed state so screen readers don't announce a phantom region.
    expect(html).toContain('aria-expanded="false"')
  })

  test('generateAssistDraft forwards sample text and non-auto language', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')

    ;(api.assistEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'entity_types_guidance: drafted\n',
      validation: { valid: true, errors: [] },
      warnings: [],
      raw_output: 'entity_types_guidance: drafted\n',
      model: 'm'
    })

    await page.generateAssistDraft({
      requirements: 'medical',
      currentContent: '',
      sampleText: 'patient record snippet',
      language: 'zh'
    })

    expect(api.assistEntityTypePrompt).toHaveBeenCalledWith({
      requirements: 'medical',
      sample_text: 'patient record snippet',
      language: 'zh'
    })
  })

  test('generateAssistDraft omits auto language and blank sample text', async () => {
    const api = await import('@/api/lightrag')
    const page = await import('./Prompts')

    ;(api.assistEntityTypePrompt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: '',
      validation: { valid: false, errors: ['empty'] },
      warnings: [],
      raw_output: '',
      model: null
    })

    await page.generateAssistDraft({
      requirements: 'r',
      currentContent: '',
      sampleText: '',
      language: 'auto'
    })

    expect(api.assistEntityTypePrompt).toHaveBeenCalledWith({ requirements: 'r' })
  })
})

describe('Prompt activation semantics', () => {
  test('promptActionForSelection keys off the selected file, not global active state', async () => {
    const page = await import('./Prompts')

    // Nothing selected → offer activate (disabled by the button itself).
    expect(page.promptActionForSelection(null)).toBe('activate')
    // Selected file is inactive → activate it (even if another file is active).
    expect(page.promptActionForSelection(workspaceFile({ active: false }))).toBe('activate')
    // Selected file is the active one → offer deactivate.
    expect(page.promptActionForSelection(workspaceFile({ active: true }))).toBe('deactivate')
  })
})

describe('Validation display state', () => {
  test('resolveValidationDisplay distinguishes valid/invalid/stale/none', async () => {
    const page = await import('./Prompts')
    const v = (valid: boolean, errors: string[] = []) => ({ valid, errors })

    // Never validated (preset / blank / after deactivate) → no badge.
    expect(
      page.resolveValidationDisplay({ validation: v(false), content: 'a', lastValidatedContent: null })
    ).toBe('none')
    // Content matches what was validated → trust the result.
    expect(
      page.resolveValidationDisplay({ validation: v(true), content: 'a', lastValidatedContent: 'a' })
    ).toBe('valid')
    expect(
      page.resolveValidationDisplay({ validation: v(false, ['e']), content: 'a', lastValidatedContent: 'a' })
    ).toBe('invalid')
    // Edited since validation → stale, regardless of the old verdict.
    expect(
      page.resolveValidationDisplay({ validation: v(true), content: 'b', lastValidatedContent: 'a' })
    ).toBe('stale')
    expect(
      page.resolveValidationDisplay({ validation: v(false, ['e']), content: 'b', lastValidatedContent: 'a' })
    ).toBe('stale')
  })
})
