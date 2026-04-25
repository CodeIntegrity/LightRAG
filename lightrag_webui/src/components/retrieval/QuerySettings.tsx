import { useCallback, useEffect, useMemo, useState } from 'react'
import { QueryMode, QueryRequest, createPromptConfigVersion } from '@/api/lightrag'
// Removed unused import for Text component
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import UserPromptInputWithHistory from '@/components/ui/UserPromptInputWithHistory'
import PromptOverridesEditor from '@/components/retrieval/PromptOverridesEditor'
import RetrievalPromptVersionSelector from '@/components/retrieval/RetrievalPromptVersionSelector'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/Select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import { useSettingsStore } from '@/stores/settings'
import { useBackendState } from '@/stores/state'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

export const numericQuerySettingDefaults = {
  top_k: 40,
  chunk_top_k: 20,
  max_entity_tokens: 6000,
  max_relation_tokens: 8000,
  max_total_tokens: 30000,
  history_turns: 0
} as const

export type NumericQuerySettingKey = keyof typeof numericQuerySettingDefaults

export const normalizeNumericDraft = (
  rawValue: string,
  fallbackValue: number,
  minValue: number
): number => {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return fallbackValue
  }

  const parsedValue = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsedValue)) {
    return fallbackValue
  }

  return Math.max(minValue, parsedValue)
}

export const applyQuerySettingsDependencies = (
  currentSettings: Omit<QueryRequest, 'query'>,
  nextSettings: Partial<Omit<QueryRequest, 'query'>>
): Partial<Omit<QueryRequest, 'query'>> => {
  const mergedSettings = {
    ...currentSettings,
    ...nextSettings
  }
  const resolvedSettings: Partial<Omit<QueryRequest, 'query'>> = { ...nextSettings }

  if (nextSettings.only_need_context === true) {
    resolvedSettings.only_need_prompt = false
    resolvedSettings.stream = false
  }

  if (nextSettings.only_need_prompt === true) {
    resolvedSettings.only_need_context = false
    resolvedSettings.stream = false
  }

  if (
    nextSettings.stream === true &&
    (mergedSettings.only_need_context || mergedSettings.only_need_prompt)
  ) {
    resolvedSettings.stream = false
  }

  if (nextSettings.include_references === false) {
    resolvedSettings.include_chunk_content = false
  }

  if (nextSettings.include_chunk_content === true) {
    resolvedSettings.include_references = true
  }

  return resolvedSettings
}

const ResetButton = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="mr-1 rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          title={title}
        >
          <RotateCcw className="h-3 w-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p>{title}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)

export default function QuerySettings() {
  const { t } = useTranslation()
  const querySettings = useSettingsStore((state) => state.querySettings)
  const userPromptHistory = useSettingsStore((state) => state.userPromptHistory)
  const retrievalPromptVersionSelection = useSettingsStore(
    (state) => state.retrievalPromptVersionSelection
  )
  const retrievalPromptDraft = useSettingsStore((state) => state.retrievalPromptDraft)
  const allowPromptOverridesViaApi = useBackendState.use.allowPromptOverridesViaApi()
  const rerankConfigured = useBackendState.use.status()?.configuration?.enable_rerank ?? false
  const rerankModel = useBackendState.use.status()?.configuration?.rerank_model ?? null
  const rerankAvailable = rerankConfigured && !!rerankModel
  const promptOverridesEnabled = allowPromptOverridesViaApi && querySettings.mode !== 'bypass'
  const promptOverridesDisabledReason = !allowPromptOverridesViaApi
    ? t('retrievePanel.querySettings.promptOverrides.disabledHint')
    : t('retrievePanel.querySettings.promptOverrides.bypassHint')
  const [numericDrafts, setNumericDrafts] = useState<Record<NumericQuerySettingKey, string>>(
    () => ({
      top_k: String(querySettings.top_k ?? numericQuerySettingDefaults.top_k),
      chunk_top_k: String(querySettings.chunk_top_k ?? numericQuerySettingDefaults.chunk_top_k),
      max_entity_tokens: String(
        querySettings.max_entity_tokens ?? numericQuerySettingDefaults.max_entity_tokens
      ),
      max_relation_tokens: String(
        querySettings.max_relation_tokens ?? numericQuerySettingDefaults.max_relation_tokens
      ),
      max_total_tokens: String(
        querySettings.max_total_tokens ?? numericQuerySettingDefaults.max_total_tokens
      ),
      history_turns: String(
        querySettings.history_turns ?? numericQuerySettingDefaults.history_turns
      )
    })
  )

  useEffect(() => {
    setNumericDrafts({
      top_k: String(querySettings.top_k ?? numericQuerySettingDefaults.top_k),
      chunk_top_k: String(querySettings.chunk_top_k ?? numericQuerySettingDefaults.chunk_top_k),
      max_entity_tokens: String(
        querySettings.max_entity_tokens ?? numericQuerySettingDefaults.max_entity_tokens
      ),
      max_relation_tokens: String(
        querySettings.max_relation_tokens ?? numericQuerySettingDefaults.max_relation_tokens
      ),
      max_total_tokens: String(
        querySettings.max_total_tokens ?? numericQuerySettingDefaults.max_total_tokens
      ),
      history_turns: String(
        querySettings.history_turns ?? numericQuerySettingDefaults.history_turns
      )
    })
  }, [
    querySettings.chunk_top_k,
    querySettings.history_turns,
    querySettings.max_entity_tokens,
    querySettings.max_relation_tokens,
    querySettings.max_total_tokens,
    querySettings.top_k
  ])

  const handleChange = useCallback((settings: Partial<Omit<QueryRequest, 'query'>>) => {
    const currentSettings = useSettingsStore.getState().querySettings
    useSettingsStore
      .getState()
      .updateQuerySettings(applyQuerySettingsDependencies(currentSettings, settings))
  }, [])

  const handleSelectFromHistory = useCallback(
    (prompt: string) => {
      handleChange({ user_prompt: prompt })
    },
    [handleChange]
  )

  const handleDeleteFromHistory = useCallback(
    (index: number) => {
      const newHistory = [...userPromptHistory]
      newHistory.splice(index, 1)
      useSettingsStore.getState().setUserPromptHistory(newHistory)
    },
    [userPromptHistory]
  )

  const handleRetrievalPromptVersionSelection = useCallback((value: string) => {
    useSettingsStore.getState().setRetrievalPromptVersionSelection(value)
  }, [])

  const handleRetrievalPromptDraftChange = useCallback((value: any) => {
    useSettingsStore.getState().setRetrievalPromptDraft(value)
  }, [])

  const handleSaveDraftAsVersion = useCallback(
    async (payload: Record<string, unknown>) => {
      const versionName = `retrieval-custom-${Date.now()}`
      const saved = await createPromptConfigVersion('retrieval', {
        version_name: versionName,
        comment: 'Saved from retrieval page draft',
        payload
      })
      toast.success(
        t('retrievePanel.querySettings.promptOverrides.savedAsVersion', {
          name: saved.version_name
        })
      )
      useSettingsStore.getState().setRetrievalPromptVersionSelection(saved.version_id)
      useSettingsStore.getState().setRetrievalPromptDraft(undefined)
    },
    [t]
  )

  // Default values for reset functionality
  const defaultValues = useMemo(
    () => ({
      mode: 'mix' as QueryMode,
      ...numericQuerySettingDefaults
    }),
    []
  )

  const handleReset = useCallback(
    (key: keyof typeof defaultValues) => {
      if (key in numericQuerySettingDefaults) {
        const numericKey = key as NumericQuerySettingKey
        const nextValue = defaultValues[numericKey]
        setNumericDrafts((currentDrafts) => ({
          ...currentDrafts,
          [numericKey]: String(nextValue)
        }))
        handleChange({ [numericKey]: nextValue })
        return
      }

      handleChange({ [key]: defaultValues[key] })
    },
    [handleChange, defaultValues]
  )

  const handleNumericDraftChange = useCallback((key: NumericQuerySettingKey, value: string) => {
    setNumericDrafts((currentDrafts) => ({
      ...currentDrafts,
      [key]: value
    }))
  }, [])

  const commitNumericDraft = useCallback(
    (key: NumericQuerySettingKey) => {
      const fallbackValue = numericQuerySettingDefaults[key]
      const minValue = key === 'history_turns' ? 0 : 1
      const nextValue = normalizeNumericDraft(numericDrafts[key], fallbackValue, minValue)
      setNumericDrafts((currentDrafts) => ({
        ...currentDrafts,
        [key]: String(nextValue)
      }))
      handleChange({ [key]: nextValue })
    },
    [handleChange, numericDrafts]
  )

  const streamLocked = querySettings.only_need_context || querySettings.only_need_prompt

  return (
    <Card className="flex w-[280px] shrink-0 flex-col">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle>{t('retrievePanel.querySettings.parametersTitle')}</CardTitle>
        <CardDescription className="sr-only">
          {t('retrievePanel.querySettings.parametersDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="m-0 flex grow flex-col p-0 text-xs">
        <div className="relative size-full">
          <div className="absolute inset-0 flex flex-col gap-2 overflow-auto px-2 pr-2">
            {/* User Prompt - Moved to top for better dropdown space */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="user_prompt" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.userPrompt')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.userPromptTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div>
                <UserPromptInputWithHistory
                  id="user_prompt"
                  value={querySettings.user_prompt || ''}
                  onChange={(value) => handleChange({ user_prompt: value })}
                  onSelectFromHistory={handleSelectFromHistory}
                  onDeleteFromHistory={handleDeleteFromHistory}
                  history={userPromptHistory}
                  placeholder={t('retrievePanel.querySettings.userPromptPlaceholder')}
                  className="h-9"
                />
              </div>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.promptVersionLabel')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.promptVersionTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <RetrievalPromptVersionSelector
                enabled={promptOverridesEnabled}
                value={retrievalPromptVersionSelection}
                onChange={handleRetrievalPromptVersionSelection}
              />

              {retrievalPromptVersionSelection === 'custom' ? (
                <PromptOverridesEditor
                  enabled={promptOverridesEnabled}
                  disabledReason={promptOverridesDisabledReason}
                  value={retrievalPromptDraft}
                  onChange={handleRetrievalPromptDraftChange}
                  onSaveAsVersion={handleSaveDraftAsVersion}
                />
              ) : null}
            </>

            {/* Query Mode */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="query_mode_select" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.queryMode')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.queryModeTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-1">
                <Select
                  value={querySettings.mode}
                  onValueChange={(v) => handleChange({ mode: v as QueryMode })}
                >
                  <SelectTrigger
                    id="query_mode_select"
                    className="hover:bg-primary/5 h-9 flex-1 cursor-pointer text-left focus:ring-0 focus:ring-offset-0 focus:outline-0 active:right-0 [&>span]:line-clamp-1 [&>span]:break-all"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="naive">
                        {t('retrievePanel.querySettings.queryModeOptions.naive')}
                      </SelectItem>
                      <SelectItem value="local">
                        {t('retrievePanel.querySettings.queryModeOptions.local')}
                      </SelectItem>
                      <SelectItem value="global">
                        {t('retrievePanel.querySettings.queryModeOptions.global')}
                      </SelectItem>
                      <SelectItem value="hybrid">
                        {t('retrievePanel.querySettings.queryModeOptions.hybrid')}
                      </SelectItem>
                      <SelectItem value="mix">
                        {t('retrievePanel.querySettings.queryModeOptions.mix')}
                      </SelectItem>
                      <SelectItem value="bypass">
                        {t('retrievePanel.querySettings.queryModeOptions.bypass')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <ResetButton onClick={() => handleReset('mode')} title="Reset to default (Mix)" />
              </div>
            </>

            {/* Top K */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="top_k" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.topK')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.topKTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-1">
                <Input
                  id="top_k"
                  type="number"
                  value={numericDrafts.top_k}
                  onChange={(e) => handleNumericDraftChange('top_k', e.target.value)}
                  onBlur={() => commitNumericDraft('top_k')}
                  min={1}
                  placeholder={t('retrievePanel.querySettings.topKPlaceholder')}
                  className="h-9 flex-1 pr-2 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <ResetButton onClick={() => handleReset('top_k')} title="Reset to default" />
              </div>
            </>

            {/* Chunk Top K */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="chunk_top_k" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.chunkTopK')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.chunkTopKTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-1">
                <Input
                  id="chunk_top_k"
                  type="number"
                  value={numericDrafts.chunk_top_k}
                  onChange={(e) => handleNumericDraftChange('chunk_top_k', e.target.value)}
                  onBlur={() => commitNumericDraft('chunk_top_k')}
                  min={1}
                  placeholder={t('retrievePanel.querySettings.chunkTopKPlaceholder')}
                  className="h-9 flex-1 pr-2 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <ResetButton onClick={() => handleReset('chunk_top_k')} title="Reset to default" />
              </div>
            </>

            {/* Max Entity Tokens */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="max_entity_tokens" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.maxEntityTokens')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.maxEntityTokensTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-1">
                <Input
                  id="max_entity_tokens"
                  type="number"
                  value={numericDrafts.max_entity_tokens}
                  onChange={(e) => handleNumericDraftChange('max_entity_tokens', e.target.value)}
                  onBlur={() => commitNumericDraft('max_entity_tokens')}
                  min={1}
                  placeholder={t('retrievePanel.querySettings.maxEntityTokensPlaceholder')}
                  className="h-9 flex-1 pr-2 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <ResetButton
                  onClick={() => handleReset('max_entity_tokens')}
                  title="Reset to default"
                />
              </div>
            </>

            {/* Max Relation Tokens */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="max_relation_tokens" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.maxRelationTokens')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.maxRelationTokensTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-1">
                <Input
                  id="max_relation_tokens"
                  type="number"
                  value={numericDrafts.max_relation_tokens}
                  onChange={(e) => handleNumericDraftChange('max_relation_tokens', e.target.value)}
                  onBlur={() => commitNumericDraft('max_relation_tokens')}
                  min={1}
                  placeholder={t('retrievePanel.querySettings.maxRelationTokensPlaceholder')}
                  className="h-9 flex-1 pr-2 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <ResetButton
                  onClick={() => handleReset('max_relation_tokens')}
                  title="Reset to default"
                />
              </div>
            </>

            {/* Max Total Tokens */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="max_total_tokens" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.maxTotalTokens')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.maxTotalTokensTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-1">
                <Input
                  id="max_total_tokens"
                  type="number"
                  value={numericDrafts.max_total_tokens}
                  onChange={(e) => handleNumericDraftChange('max_total_tokens', e.target.value)}
                  onBlur={() => commitNumericDraft('max_total_tokens')}
                  min={1}
                  placeholder={t('retrievePanel.querySettings.maxTotalTokensPlaceholder')}
                  className="h-9 flex-1 pr-2 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <ResetButton
                  onClick={() => handleReset('max_total_tokens')}
                  title="Reset to default"
                />
              </div>
            </>

            {/* Toggle Options */}
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label htmlFor="history_turns" className="ml-1 cursor-help">
                      {t('retrievePanel.querySettings.historyTurns')}
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{t('retrievePanel.querySettings.historyTurnsTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-1">
                <Input
                  id="history_turns"
                  type="number"
                  value={numericDrafts.history_turns}
                  onChange={(e) => handleNumericDraftChange('history_turns', e.target.value)}
                  onBlur={() => commitNumericDraft('history_turns')}
                  min={0}
                  placeholder={t('retrievePanel.querySettings.historyTurnsPlaceholder')}
                  className="h-9 flex-1 pr-2 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <ResetButton
                  onClick={() => handleReset('history_turns')}
                  title="Reset to default"
                />
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label htmlFor="enable_rerank" className="ml-1 flex-1 cursor-help">
                        {t('retrievePanel.querySettings.enableRerank')}
                        {!rerankAvailable && querySettings.enable_rerank && (
                          <span className="ml-1 text-amber-500" title="Rerank model not configured">
                            ⚠
                          </span>
                        )}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>
                        {querySettings.enable_rerank && !rerankAvailable
                          ? t(
                              'retrievePanel.querySettings.enableRerankWarning',
                              'Enabled but no rerank model is configured. This setting will have no effect.'
                            )
                          : t('retrievePanel.querySettings.enableRerankTooltip')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Checkbox
                  className="mr-10 cursor-pointer"
                  id="enable_rerank"
                  checked={querySettings.enable_rerank}
                  onCheckedChange={(checked) => handleChange({ enable_rerank: checked })}
                />
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label htmlFor="only_need_context" className="ml-1 flex-1 cursor-help">
                        {t('retrievePanel.querySettings.onlyNeedContext')}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>{t('retrievePanel.querySettings.onlyNeedContextTooltip')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Checkbox
                  className="mr-10 cursor-pointer"
                  id="only_need_context"
                  checked={querySettings.only_need_context}
                  onCheckedChange={(checked) => handleChange({ only_need_context: checked })}
                />
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label htmlFor="only_need_prompt" className="ml-1 flex-1 cursor-help">
                        {t('retrievePanel.querySettings.onlyNeedPrompt')}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>{t('retrievePanel.querySettings.onlyNeedPromptTooltip')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Checkbox
                  className="mr-10 cursor-pointer"
                  id="only_need_prompt"
                  checked={querySettings.only_need_prompt}
                  onCheckedChange={(checked) => handleChange({ only_need_prompt: checked })}
                />
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label htmlFor="stream" className="ml-1 flex-1 cursor-help">
                        {t('retrievePanel.querySettings.streamResponse')}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>{t('retrievePanel.querySettings.streamResponseTooltip')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Checkbox
                  className="mr-10 cursor-pointer"
                  id="stream"
                  checked={querySettings.stream}
                  disabled={streamLocked}
                  onCheckedChange={(checked) => handleChange({ stream: checked })}
                />
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label htmlFor="include_references" className="ml-1 flex-1 cursor-help">
                        {t('retrievePanel.querySettings.includeReferences')}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>{t('retrievePanel.querySettings.includeReferencesTooltip')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Checkbox
                  className="mr-10 cursor-pointer"
                  id="include_references"
                  checked={querySettings.include_references}
                  onCheckedChange={(checked) => handleChange({ include_references: checked })}
                />
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label htmlFor="include_chunk_content" className="ml-1 flex-1 cursor-help">
                        {t('retrievePanel.querySettings.includeChunkContent')}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>{t('retrievePanel.querySettings.includeChunkContentTooltip')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Checkbox
                  className="mr-10 cursor-pointer"
                  id="include_chunk_content"
                  checked={querySettings.include_chunk_content}
                  disabled={!querySettings.include_references}
                  onCheckedChange={(checked) => handleChange({ include_chunk_content: checked })}
                />
              </div>
            </>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
