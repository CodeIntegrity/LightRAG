import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2Icon, ChevronDownIcon, FileTextIcon, PlayIcon, RefreshCwIcon, SaveIcon, SparklesIcon, XCircleIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import {
  activateEntityTypePrompt,
  assistEntityTypePrompt,
  deactivateEntityTypePrompt,
  listEntityTypePrompts,
  readEntityTypePrompt,
  saveEntityTypePromptVersion,
  validateEntityTypePrompt,
  type EntityTypePromptAssistRequest,
  type EntityTypePromptAssistResponse,
  type EntityTypePromptFile,
  type EntityTypePromptListResponse,
  type EntityTypePromptValidation
} from '@/api/lightrag'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/AlertDialog'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Separator from '@/components/ui/Separator'
import Textarea from '@/components/ui/Textarea'
import YamlEditor from '@/components/ui/YamlEditor'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { useSettingsStore } from '@/stores/settings'
import { presetPrompts } from '@/features/promptPresets'
import { cn } from '@/lib/utils'

const emptyList: EntityTypePromptListResponse = {
  workspace: '',
  active_file: null,
  files: []
}

const emptyValidation: EntityTypePromptValidation = {
  valid: false,
  errors: []
}

export type PromptEditorState = {
  workspaceKey: string
  list: EntityTypePromptListResponse
  selectedFileName: string | null
  content: string
  validation: EntityTypePromptValidation
}

export type PromptEditorStateInput = Partial<PromptEditorState> & {
  workspaceKey: string
}

export const createPromptEditorState = (
  input: PromptEditorStateInput
): PromptEditorState => ({
  workspaceKey: input.workspaceKey,
  list: input.list ?? emptyList,
  selectedFileName: input.selectedFileName ?? null,
  content: input.content ?? '',
  validation: input.validation ?? emptyValidation
})

export const chooseInitialFile = (list: EntityTypePromptListResponse): EntityTypePromptFile | null => {
  if (list.files.length === 0) {
    return null
  }
  return list.files.find((file) => file.file_name === list.active_file) ?? list.files[0]
}

export const loadPromptEditorState = async (
  workspaceKey: string
): Promise<PromptEditorState> => {
  const list = await listEntityTypePrompts()
  const selected = chooseInitialFile(list)
  if (!selected) {
    return createPromptEditorState({
      workspaceKey,
      list,
      validation: { valid: false, errors: [] }
    })
  }

  const readResponse = await readEntityTypePrompt(selected.file_name)
  return createPromptEditorState({
    workspaceKey,
    list,
    selectedFileName: readResponse.file_name,
    content: readResponse.content,
    validation: readResponse.validation
  })
}

export const selectPromptFile = async (
  state: PromptEditorState,
  fileName: string
): Promise<PromptEditorState> => {
  const readResponse = await readEntityTypePrompt(fileName)
  return {
    ...state,
    selectedFileName: readResponse.file_name,
    content: readResponse.content,
    validation: readResponse.validation
  }
}

export const validatePromptContent = async (
  state: PromptEditorState,
  useJson?: boolean
): Promise<PromptEditorState> => {
  const request = typeof useJson === 'boolean'
    ? { content: state.content, use_json: useJson }
    : { content: state.content }
  const validation = await validateEntityTypePrompt(request)
  return {
    ...state,
    validation
  }
}

export const savePromptVersion = async (
  state: PromptEditorState,
  options: {
    promptSlug: string
    version: number
    activate: boolean
  }
): Promise<PromptEditorState> => {
  const response = await saveEntityTypePromptVersion(
    options.promptSlug,
    options.version,
    {
      content: state.content,
      activate: options.activate
    }
  )
  const filesByName = new Map(state.list.files.map((file) => [file.file_name, file]))
  filesByName.set(response.file.file_name, response.file)
  const files = Array.from(filesByName.values()).map((file) => ({
    ...file,
    active: file.file_name === response.active_file
  }))

  return {
    ...state,
    list: {
      ...state.list,
      active_file: response.active_file,
      files
    },
    selectedFileName: response.file.file_name,
    validation: response.validation
  }
}

export const activateSelectedPrompt = async (
  state: PromptEditorState
): Promise<PromptEditorState> => {
  if (!state.selectedFileName) {
    return state
  }
  const response = await activateEntityTypePrompt(state.selectedFileName)
  const files = state.list.files.map((file) => ({
    ...file,
    active: file.file_name === response.active_file
  }))
  const existingIndex = files.findIndex((file) => file.file_name === response.file.file_name)
  if (existingIndex >= 0) {
    files[existingIndex] = response.file
  } else {
    files.push(response.file)
  }
  return {
    ...state,
    list: {
      ...state.list,
      active_file: response.active_file,
      files
    },
    validation: response.validation
  }
}

export const deactivateSelectedPrompt = async (
  state: PromptEditorState
): Promise<PromptEditorState> => {
  const response = await deactivateEntityTypePrompt()
  const files = state.list.files.map((file) => ({
    ...file,
    active: false
  }))
  return {
    ...state,
    list: {
      ...state.list,
      active_file: null,
      files
    },
    validation: { valid: false, errors: [] }
  }
}

export const shouldReloadPromptEditor = (
  state: PromptEditorState,
  workspaceKey: string
): boolean => state.workspaceKey !== workspaceKey

export const formatPromptFileTitle = (file: EntityTypePromptFile): string => file.prompt_slug

export const formatPromptFileMeta = (file: EntityTypePromptFile): string => {
  const version = file.version > 0 ? `v${file.version}` : 'global'
  const updatedAt = file.updated_at ? ` · ${file.updated_at}` : ''
  return `${version} · ${file.source}${updatedAt}`
}

export type AssistDraftResponse = EntityTypePromptAssistResponse

/**
 * Pure helper that wraps the API client and strips empty current_content.
 * Keeping the request shape minimal lets the backend apply its own defaults
 * (language="auto", use_json from runtime config).
 */
export const generateAssistDraft = async (params: {
  requirements: string
  currentContent: string
}): Promise<AssistDraftResponse> => {
  const request: EntityTypePromptAssistRequest = {
    requirements: params.requirements
  }
  if (params.currentContent) {
    request.current_content = params.currentContent
  }
  return await assistEntityTypePrompt(request)
}

/**
 * Pure helper. Apply must overwrite editor content & validation while
 * leaving list state alone — saved/selectedFileName tracking is the caller's
 * responsibility.
 */
export const applyAssistDraft = (
  state: PromptEditorState,
  response: AssistDraftResponse
): PromptEditorState => ({
  ...state,
  content: response.content,
  validation: response.validation
})

/**
 * Combined confirmation gate: a single user prompt covers both the
 * "unsaved changes will be overwritten" and the "draft has not passed
 * validation" risks. The caller decides the actual confirm UX.
 */
export const shouldConfirmAssistApply = (params: {
  hasUnsavedChanges: boolean
  draftValidationValid: boolean
}): boolean => params.hasUnsavedChanges || !params.draftValidationValid

const _ASSIST_ERROR_KEYS: Record<number, string> = {
  500: 'prompts.assist.error.internal',
  502: 'prompts.assist.error.providerFailed',
  503: 'prompts.assist.error.unavailable'
}

const _resolveAssistErrorKey = (error: unknown): string | null => {
  const status = (error as { response?: { status?: number } })?.response?.status
  if (typeof status === 'number' && status in _ASSIST_ERROR_KEYS) {
    return _ASSIST_ERROR_KEYS[status]
  }
  return null
}

export default function Prompts() {
  const { t } = useTranslation()
  const currentWorkspace = useSettingsStore.use.currentWorkspace()
  const workspaceKey = currentWorkspace || 'default'
  const [state, setState] = useState<PromptEditorState>(() =>
    createPromptEditorState({ workspaceKey })
  )
  const [promptSlug, setPromptSlug] = useState('entity-type')
  const [version, setVersion] = useState(1)
  const [activateOnSave, setActivateOnSave] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState('')
  const [presetPopoverOpen, setPresetPopoverOpen] = useState(false)
  const [validationDialogOpen, setValidationDialogOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [assistRequirements, setAssistRequirements] = useState('')
  const [assistDraft, setAssistDraft] = useState<AssistDraftResponse | null>(null)
  const [assistLoading, setAssistLoading] = useState(false)
  const [assistRawOpen, setAssistRawOpen] = useState(false)

  const hasUnsavedChanges = state.content !== savedContent

  const selectedFile = useMemo(
    () => state.list.files.find((file) => file.file_name === state.selectedFileName) ?? null,
    [state.list.files, state.selectedFileName]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const nextState = await loadPromptEditorState(workspaceKey)
      const hasFiles = nextState.list.files.length > 0
      if (!hasFiles) {
        const defaultPreset = presetPrompts[0]
        nextState.content = defaultPreset.content
        setSavedContent(defaultPreset.content)
        setSelectedPresetId(defaultPreset.id)
      } else {
        setSelectedPresetId(null)
        setSavedContent(nextState.content)
      }
      setState(nextState)
      const initialFile = chooseInitialFile(nextState.list)
      if (initialFile?.source === 'workspace') {
        setPromptSlug(initialFile.prompt_slug)
        setVersion(Math.max(initialFile.version, 1))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      setState(createPromptEditorState({ workspaceKey }))
      setSelectedPresetId(null)
    } finally {
      setLoading(false)
    }
  }, [workspaceKey])

  useEffect(() => {
    if (!state.list.workspace || shouldReloadPromptEditor(state, workspaceKey)) {
      void load()
    }
  }, [load, state, workspaceKey])

  const handleSelect = useCallback(async (fileName: string) => {
    if (hasUnsavedChanges && !window.confirm(t('prompts.unsavedWarning', 'You have unsaved changes. Discard them?'))) {
      return
    }
    try {
      const nextState = await selectPromptFile(state, fileName)
      setSavedContent(nextState.content)
      setState(nextState)
      setSelectedPresetId(null)
      const file = nextState.list.files.find((item) => item.file_name === fileName)
      if (file?.source === 'workspace') {
        setPromptSlug(file.prompt_slug)
        setVersion(Math.max(file.version, 1))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [state, hasUnsavedChanges, t])

  const handleLoadPreset = useCallback((preset: typeof presetPrompts[number]) => {
    if (hasUnsavedChanges && !window.confirm(t('prompts.unsavedWarning', 'You have unsaved changes. Discard them?'))) {
      return
    }
    setSavedContent(preset.content)
    setSelectedPresetId(preset.id)
    setPresetPopoverOpen(false)
    setState((previous) => ({
      ...previous,
      content: preset.content,
      selectedFileName: null
    }))
  }, [hasUnsavedChanges, t])

  const handleNewBlank = useCallback(() => {
    if (hasUnsavedChanges && !window.confirm(t('prompts.unsavedWarning', 'You have unsaved changes. Discard them?'))) {
      return
    }
    setSavedContent('')
    setSelectedPresetId(null)
    setState((previous) => ({
      ...previous,
      content: '',
      selectedFileName: null
    }))
  }, [hasUnsavedChanges, t])

  const handleValidate = useCallback(async () => {
    try {
      const nextState = await validatePromptContent(state)
      setState(nextState)
      if (nextState.validation.valid) {
        toast.success(t('prompts.validation.valid', 'Prompt is valid'))
      } else {
        setValidationDialogOpen(true)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [state, t])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const nextState = await savePromptVersion(state, {
        promptSlug,
        version,
        activate: activateOnSave
      })
      setSavedContent(nextState.content)
      setState(nextState)
      setSelectedPresetId(null)
      toast.success(t('prompts.saved', 'Prompt saved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [activateOnSave, promptSlug, state, t, version])

  const handleActivate = useCallback(async () => {
    try {
      const nextState = await activateSelectedPrompt(state)
      setState(nextState)
      toast.success(t('prompts.activated', 'Prompt activated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [state, t])

  const handleDeactivate = useCallback(async () => {
    try {
      const nextState = await deactivateSelectedPrompt(state)
      setState(nextState)
      toast.success(t('prompts.deactivated', 'Prompt deactivated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [state, t])

  const handleCloseAssist = useCallback(() => setAssistOpen(false), [])

  const handleToggleAssist = useCallback(() => setAssistOpen((open) => !open), [])

  const handleGenerateAssistDraft = useCallback(async () => {
    if (!assistRequirements.trim() || assistLoading) {
      return
    }
    setAssistLoading(true)
    try {
      const response = await generateAssistDraft({
        requirements: assistRequirements,
        currentContent: state.content
      })
      setAssistDraft(response)
      setAssistRawOpen(false)
    } catch (error) {
      const key = _resolveAssistErrorKey(error)
      if (key) {
        toast.error(t(key))
      } else {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setAssistLoading(false)
    }
  }, [assistLoading, assistRequirements, state.content, t])

  const handleApplyAssistDraft = useCallback(() => {
    if (!assistDraft) {
      return
    }
    const needsConfirm = shouldConfirmAssistApply({
      hasUnsavedChanges,
      draftValidationValid: assistDraft.validation.valid
    })
    if (
      needsConfirm &&
      !window.confirm(
        t(
          'prompts.assist.applyConfirm',
          'Applying this draft will overwrite the editor (unsaved changes will be lost) and the draft has not passed validation. Continue?'
        )
      )
    ) {
      return
    }
    setState((previous) => applyAssistDraft(previous, assistDraft))
    setAssistOpen(false)
  }, [assistDraft, hasUnsavedChanges, t])

  useEffect(() => {
    if (!assistOpen) {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAssistOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [assistOpen])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div>
          <h1 className="text-base font-semibold">{t('prompts.title', 'Prompts')}</h1>
          <p className="text-xs text-muted-foreground">
            {t('prompts.workspace', 'Workspace')}: {state.list.workspace || workspaceKey}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          tooltip={t('prompts.refresh', 'Refresh')}
          onClick={() => void load()}
        >
          <RefreshCwIcon aria-hidden="true" />
          <span>{t('prompts.refresh', 'Refresh')}</span>
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,280px)_1fr] overflow-hidden">
        <aside className="min-h-0 overflow-auto border-r p-3">
          <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t('prompts.presets', 'Presets')}
          </div>
          {loading ? (
            <div className="text-sm text-muted-foreground">{t('prompts.loading', 'Loading...')}</div>
          ) : (
            <div className="space-y-2">
              {presetPrompts.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent',
                    selectedPresetId === preset.id && 'border-primary bg-accent'
                  )}
                  onClick={() => handleLoadPreset(preset)}
                >
                  <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{preset.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {preset.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {state.list.files.length > 0 && (
            <>
              <Separator className="my-3" />
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                {t('prompts.savedPrompts', 'Saved Prompts')}
              </div>
              <div className="space-y-2">
                {state.list.files.map((file) => (
                  <button
                    type="button"
                    key={file.file_name}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent',
                      state.selectedFileName === file.file_name && 'border-primary bg-accent'
                    )}
                    onClick={() => void handleSelect(file.file_name)}
                  >
                    <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{formatPromptFileTitle(file)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatPromptFileMeta(file)}
                      </span>
                    </span>
                    {file.active && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        {t('prompts.active', 'Active')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
          {!loading && state.list.files.length === 0 && (
            <div className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {t('prompts.empty', 'No prompt files')}
            </div>
          )}
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden p-4">
          <div className="mb-3 flex shrink-0 items-center gap-2">
            <Popover open={presetPopoverOpen} onOpenChange={setPresetPopoverOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <span>{t('prompts.loadFromPreset', 'Load from preset')}</span>
                  <ChevronDownIcon aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start" sideOffset={4}>
                <div className="flex flex-col gap-0.5">
                  {presetPrompts.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className="cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={() => handleLoadPreset(preset)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button type="button" variant="outline" size="sm" onClick={handleNewBlank}>
              <span>{t('prompts.newBlank', 'New blank')}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={assistOpen}
              aria-controls="prompts-assist-panel"
              aria-label={t('prompts.assist.button', 'Assist')}
              onClick={handleToggleAssist}
            >
              <SparklesIcon aria-hidden="true" />
              <span>{t('prompts.assist.button', 'Assist')}</span>
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              tooltip={t('prompts.refresh', 'Refresh')}
              onClick={() => void load()}
            >
              <RefreshCwIcon aria-hidden="true" />
            </Button>
          </div>

          {assistOpen && (
            <div
              id="prompts-assist-panel"
              role="region"
              aria-labelledby="prompts-assist-title"
              aria-live="polite"
              className="mb-3 max-h-[40vh] space-y-3 overflow-auto rounded-md border bg-muted/30 p-3"
            >
              <div className="flex items-center justify-between">
                <span id="prompts-assist-title" className="text-sm font-medium">
                  {t('prompts.assist.panelTitle', 'Assist with LLM')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('common.close', 'Close')}
                  onClick={handleCloseAssist}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('prompts.assist.requirementsLabel', 'Your requirements')}
                </span>
                <Textarea
                  value={assistRequirements}
                  onChange={(event) => setAssistRequirements(event.target.value)}
                  placeholder={t(
                    'prompts.assist.requirementsPlaceholder',
                    'e.g., extract diseases, medications, symptoms and treatments from medical records'
                  )}
                  className="min-h-[80px]"
                />
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={assistLoading || !assistRequirements.trim()}
                  onClick={() => void handleGenerateAssistDraft()}
                >
                  {assistLoading ? (
                    <>
                      <RefreshCwIcon aria-hidden="true" className="animate-spin" />
                      <span>{t('prompts.assist.generating', 'Generating...')}</span>
                    </>
                  ) : (
                    <>
                      <SparklesIcon aria-hidden="true" />
                      <span>{t('prompts.assist.generate', 'Generate draft')}</span>
                    </>
                  )}
                </Button>
                {assistDraft && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleApplyAssistDraft}
                  >
                    <span>{t('prompts.assist.apply', 'Apply draft')}</span>
                  </Button>
                )}
              </div>
              {assistDraft && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {t('prompts.assist.draftMeta', 'Generated · {{model}} · {{lines}} lines', {
                      model: assistDraft.model ?? '-',
                      lines: assistDraft.content ? assistDraft.content.split('\n').length : 0
                    })}
                  </div>
                  <YamlEditor
                    value={assistDraft.content}
                    readOnly
                    className="max-h-[200px] text-sm"
                  />
                  {!assistDraft.validation.valid && (
                    <div className="space-y-1 text-sm">
                      <div className="font-medium text-destructive">
                        {t('prompts.assist.errors.title', 'Draft did not pass validation')}
                      </div>
                      <ul className="list-inside list-disc text-destructive">
                        {assistDraft.validation.errors.slice(0, 3).map((error, idx) => (
                          <li key={idx}>{error}</li>
                        ))}
                      </ul>
                      {assistDraft.validation.errors.length > 3 && (
                        <div className="text-xs text-muted-foreground">
                          {t('prompts.assist.errors.more', '(+{{count}} more)', {
                            count: assistDraft.validation.errors.length - 3
                          })}
                        </div>
                      )}
                      <button
                        type="button"
                        className="cursor-pointer text-xs text-muted-foreground underline"
                        onClick={() => setAssistRawOpen((open) => !open)}
                      >
                        {assistRawOpen
                          ? t('prompts.assist.rawOutputHide', 'Hide raw output')
                          : t('prompts.assist.rawOutputShow', 'Show raw output')}
                      </button>
                      {assistRawOpen && (
                        <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                          {assistDraft.raw_output}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mb-3 grid shrink-0 grid-cols-[minmax(180px,1fr)_80px_auto] items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {t('prompts.promptSlug', 'Prompt slug')}
              </span>
              <Input value={promptSlug} onChange={(event) => setPromptSlug(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {t('prompts.version', 'Version')}
              </span>
              <Input
                className="w-full min-w-0"
                type="number"
                min={1}
                value={version}
                onChange={(event) => setVersion(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={activateOnSave}
                onChange={(event) => setActivateOnSave(event.target.checked)}
              />
              <span>{t('prompts.activateOnSave', 'Activate on save')}</span>
            </label>
          </div>

          <YamlEditor
            className="text-sm"
            value={state.content}
            placeholder="entity_types_guidance: |"
            onChange={(value) =>
              setState((previous) => ({
                ...previous,
                content: value
              }))
            }
          />

          <div className="mt-3 flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              {state.validation.valid ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <CheckCircle2Icon className="size-4" aria-hidden="true" />
                  {t('prompts.validation.valid', 'Prompt is valid')}
                </span>
              ) : state.validation.errors.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1 text-destructive cursor-pointer"
                  onClick={() => setValidationDialogOpen(true)}
                >
                  <XCircleIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{state.validation.errors[0]}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ({state.validation.errors.length})
                  </span>
                </button>
              ) : selectedFile ? (
                <span className="text-muted-foreground">
                  {formatPromptFileTitle(selectedFile)} · {formatPromptFileMeta(selectedFile)}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {t('prompts.newFile', 'New workspace prompt')}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" onClick={() => void handleValidate()}>
                <CheckCircle2Icon aria-hidden="true" />
                <span>{t('prompts.validate', 'Validate')}</span>
              </Button>
              {state.list.active_file ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleDeactivate()}
                >
                  <XCircleIcon aria-hidden="true" />
                  <span>{t('prompts.deactivate', 'Deactivate')}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!state.selectedFileName || saving}
                  onClick={() => void handleActivate()}
                >
                  <PlayIcon aria-hidden="true" />
                  <span>{saving ? t('common.saving', 'Saving...') : t('prompts.activate', 'Activate')}</span>
                </Button>
              )}
              <Button type="button" disabled={saving} onClick={() => void handleSave()}>
                <SaveIcon aria-hidden="true" />
                <span>{saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}</span>
              </Button>
            </div>
          </div>
        </section>
      </div>

      <AlertDialog open={validationDialogOpen} onOpenChange={setValidationDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('prompts.validation.failed', 'Validation failed')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="max-h-80 list-inside list-disc space-y-1 overflow-auto text-sm">
                {state.validation.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>{t('common.close', 'Close')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
