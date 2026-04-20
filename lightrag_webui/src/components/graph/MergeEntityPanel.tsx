import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { LocateFixedIcon } from 'lucide-react'
import {
  fetchMergeSuggestions,
  mergeGraphEntities
} from '@/api/lightrag'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'
import { useGraphStore } from '@/stores/graph'
import {
  normalizeWorkbenchMutationError,
  useGraphWorkbenchStore
} from '@/stores/graphWorkbench'
import { useSettingsStore } from '@/stores/settings'
import type { ActionInspectorSelection } from './ActionInspector'
import MergeSuggestionList from './MergeSuggestionList'
import {
  buildManualMergeDraftFromInput,
  resolveMergeEntityNavigationValue,
  createMergeEntityNavigationPlan,
  buildMergeSuggestionsRequest,
  resolveMergeSuggestionFallbackNotice,
  buildMergeDraftFromSelection,
  buildExpectedRevisionTokensForMerge,
  resolvePostMergeFollowUp,
  shouldAutoDismissMergeFollowUp,
  DEFAULT_SUGGESTION_LIMIT,
  DEFAULT_SUGGESTION_MIN_SCORE,
  MERGE_FOLLOW_UP_AUTO_DISMISS_MS
} from '@/utils/mergeEntity'
import type { PostMergeFollowUpAction } from '@/utils/mergeEntity'

export {
  buildManualMergeDraftFromInput,
  resolveMergeEntityNavigationValue,
  createMergeEntityNavigationPlan,
  buildMergeSuggestionsRequest,
  resolveMergeSuggestionFallbackNotice,
  buildExpectedRevisionTokensForMerge,
  resolvePostMergeFollowUp,
  shouldAutoDismissMergeFollowUp
} from '@/utils/mergeEntity'

type MergeEntityPanelProps = {
  selection?: ActionInspectorSelection | null
}

const MergeEntityPanel = ({ selection = null }: MergeEntityPanelProps) => {
  const { t } = useTranslation()
  const [sourceEntitiesInput, setSourceEntitiesInput] = useState('')
  const [targetEntityInput, setTargetEntityInput] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isSubmittingMerge, setIsSubmittingMerge] = useState(false)
  const [useLlmSuggestions, setUseLlmSuggestions] = useState(false)
  const [pendingNavigationEntity, setPendingNavigationEntity] = useState<string | null>(null)

  const rawGraph = useGraphStore.use.rawGraph()
  const filterDraft = useGraphWorkbenchStore.use.filterDraft()
  const appliedQuery = useGraphWorkbenchStore.use.appliedQuery()
  const mergeCandidates = useGraphWorkbenchStore.use.mergeCandidates()
  const selectedMergeCandidateTargets = useGraphWorkbenchStore.use.selectedMergeCandidateTargets()
  const mergeDraft = useGraphWorkbenchStore.use.mergeDraft()
  const lastSyncedDraftRef = useRef(mergeDraft)
  const mergeFollowUp = useGraphWorkbenchStore.use.mergeFollowUp()
  const setMergeCandidates = useGraphWorkbenchStore.use.setMergeCandidates()
  const setMergeDraft = useGraphWorkbenchStore.use.setMergeDraft()
  const importMergeCandidate = useGraphWorkbenchStore.use.importMergeCandidate()
  const setMergeFollowUp = useGraphWorkbenchStore.use.setMergeFollowUp()
  const clearMergeFollowUp = useGraphWorkbenchStore.use.clearMergeFollowUp()
  const setMutationError = useGraphWorkbenchStore.use.setMutationError()
  const clearMutationError = useGraphWorkbenchStore.use.clearMutationError()
  const requestRefresh = useGraphWorkbenchStore.use.requestRefresh()
  const applyScopeLabel = useGraphWorkbenchStore.use.applyScopeLabel()
  const setQueryLabel = useSettingsStore.use.setQueryLabel()

  useEffect(() => {
    if (mergeDraft === lastSyncedDraftRef.current) {
      return
    }
    lastSyncedDraftRef.current = mergeDraft
    setSourceEntitiesInput(mergeDraft.sourceEntities.join(', '))
    setTargetEntityInput(mergeDraft.targetEntity)
  }, [mergeDraft])

  useEffect(() => {
    if (mergeDraft.sourceEntities.length > 0 || mergeDraft.targetEntity) {
      return
    }
    const prefilled = buildMergeDraftFromSelection(selection)
    if (!prefilled.sourceEntities.length && !prefilled.targetEntity) {
      return
    }
    setMergeDraft(prefilled)
  }, [selection, mergeDraft, setMergeDraft])

  useEffect(() => {
    if (!mergeFollowUp) {
      return
    }

    const remainingMs = Math.max(
      0,
      MERGE_FOLLOW_UP_AUTO_DISMISS_MS - (Date.now() - mergeFollowUp.mergedAt)
    )
    const timer = window.setTimeout(() => {
      clearMergeFollowUp()
    }, remainingMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [mergeFollowUp, clearMergeFollowUp])

  const draftPreview = useMemo(
    () => buildManualMergeDraftFromInput(sourceEntitiesInput, targetEntityInput),
    [sourceEntitiesInput, targetEntityInput]
  )
  const focusableSourceEntity = useMemo(
    () => resolveMergeEntityNavigationValue(sourceEntitiesInput, targetEntityInput, 'source'),
    [sourceEntitiesInput, targetEntityInput]
  )
  const focusableTargetEntity = useMemo(
    () => resolveMergeEntityNavigationValue(sourceEntitiesInput, targetEntityInput, 'target'),
    [sourceEntitiesInput, targetEntityInput]
  )

  const canSubmitMerge = draftPreview.sourceEntities.length > 0 && !!draftPreview.targetEntity

  useEffect(() => {
    if (!pendingNavigationEntity) {
      return
    }

    const plan = createMergeEntityNavigationPlan(rawGraph, pendingNavigationEntity)
    if (!plan || !plan.nodeId) {
      return
    }

    const graphStore = useGraphStore.getState()
    graphStore.setFocusedNode(plan.nodeId)
    graphStore.setSelectedNode(plan.nodeId, true)
    setPendingNavigationEntity(null)
  }, [rawGraph, pendingNavigationEntity])

  const handleLoadSuggestions = async () => {
    if (isLoadingSuggestions) return

    setSuggestionError(null)
    setSuggestionNotice(null)
    setIsLoadingSuggestions(true)
    clearMutationError()

    try {
      const request = buildMergeSuggestionsRequest(
        appliedQuery,
        filterDraft,
        DEFAULT_SUGGESTION_LIMIT,
        DEFAULT_SUGGESTION_MIN_SCORE,
        useLlmSuggestions
      )
      const response = await fetchMergeSuggestions(request)
      setMergeCandidates(response.candidates)
      const fallbackNotice = resolveMergeSuggestionFallbackNotice(response.meta, t)
      setSuggestionNotice(fallbackNotice)
      if (fallbackNotice) {
        toast.warning(fallbackNotice)
      }
      if (!response.candidates.length) {
        toast.info(t('graphPanel.workbench.merge.messages.noSuggestions'))
      }
    } catch (error) {
      const normalized = normalizeWorkbenchMutationError(
        error,
        t('graphPanel.workbench.merge.errors.loadSuggestionsFailed')
      )
      setSuggestionError(normalized.message)
      setMutationError(normalized.message, normalized.isConflict)
      toast.error(normalized.message)
    } finally {
      setIsLoadingSuggestions(false)
    }
  }

  const handleImportCandidate = (candidate: (typeof mergeCandidates)[number]) => {
    importMergeCandidate(candidate)
    setErrorMessage(null)
    setSuggestionError(null)
    clearMutationError()
  }

  const navigateToEntity = (entityName: string) => {
    const plan = createMergeEntityNavigationPlan(rawGraph, entityName)
    if (!plan) {
      return
    }

    const graphStore = useGraphStore.getState()
    if (plan.nodeId) {
      graphStore.setFocusedNode(plan.nodeId)
      graphStore.setSelectedNode(plan.nodeId, true)
      return
    }

    setPendingNavigationEntity(plan.entityName)
    graphStore.setGraphDataFetchAttempted(false)
    if (appliedQuery) {
      applyScopeLabel(plan.entityName)
    } else {
      setQueryLabel(plan.entityName)
    }
  }

  const handleSubmitMerge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmittingMerge) return

    const draft = buildManualMergeDraftFromInput(sourceEntitiesInput, targetEntityInput)
    setMergeDraft(draft)

    if (!draft.targetEntity) {
      const message = t('graphPanel.workbench.merge.errors.targetRequired')
      setErrorMessage(message)
      setMutationError(message, false)
      return
    }

    if (!draft.sourceEntities.length) {
      const message = t('graphPanel.workbench.merge.errors.sourceRequired')
      setErrorMessage(message)
      setMutationError(message, false)
      return
    }

    setIsSubmittingMerge(true)
    setErrorMessage(null)
    clearMutationError()

    try {
      const expectedRevisionTokens = buildExpectedRevisionTokensForMerge(
        draft,
        selection
      )
      await mergeGraphEntities(
        draft.sourceEntities,
        draft.targetEntity,
        expectedRevisionTokens
      )
      setMergeFollowUp(draft.targetEntity, draft.sourceEntities)
      toast.success(
        t('graphPanel.workbench.merge.messages.merged', {
          count: draft.sourceEntities.length,
          target: draft.targetEntity
        })
      )
    } catch (error) {
      const normalized = normalizeWorkbenchMutationError(
        error,
        t('graphPanel.workbench.merge.errors.mergeFailed')
      )
      setErrorMessage(normalized.message)
      setMutationError(normalized.message, normalized.isConflict)
      toast.error(normalized.message)
    } finally {
      setIsSubmittingMerge(false)
    }
  }

  const handlePostMergeAction = (action: PostMergeFollowUpAction) => {
    if (!mergeFollowUp) return

    const outcome = resolvePostMergeFollowUp(action, mergeFollowUp.targetEntity)
    const graphStore = useGraphStore.getState()
    graphStore.setGraphDataFetchAttempted(false)
    if (outcome.focusTarget) {
      const target = outcome.focusTarget
      graphStore.setFocusedNode(target)
      graphStore.setSelectedNode(target, true)
      if (appliedQuery) {
        applyScopeLabel(target)
      } else {
        setQueryLabel(target)
      }
    }

    if (outcome.shouldRefresh) {
      requestRefresh()
      graphStore.incrementGraphDataVersion()
    }

    if (outcome.dismissActions) {
      clearMergeFollowUp()
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmitMerge} className="bg-background/60 space-y-3 rounded-lg border p-3">
        <div>
          <h3 className="text-sm font-semibold">{t('graphPanel.workbench.merge.manual.title')}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('graphPanel.workbench.merge.manual.description')}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
            {t('graphPanel.workbench.merge.manual.fields.sourceEntities')}
          </label>
          <div className="flex items-center gap-2">
            <Input
              value={sourceEntitiesInput}
              onChange={(event) => setSourceEntitiesInput(event.target.value)}
              placeholder={t('graphPanel.workbench.merge.manual.placeholders.sourceEntities')}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="shrink-0"
              tooltip={
                focusableSourceEntity
                  ? t('graphPanel.workbench.merge.manual.actions.focusSource', {
                      entity: focusableSourceEntity
                    })
                  : t('graphPanel.workbench.merge.manual.actions.focusSourceEmpty')
              }
              onClick={() => navigateToEntity(focusableSourceEntity)}
              disabled={!focusableSourceEntity}
            >
              <LocateFixedIcon />
            </Button>
          </div>
          <p className="text-muted-foreground text-[11px]">
            {t('graphPanel.workbench.merge.manual.help.sourceEntities')}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
            {t('graphPanel.workbench.merge.manual.fields.targetEntity')}
          </label>
          <div className="flex items-center gap-2">
            <Input
              value={targetEntityInput}
              onChange={(event) => setTargetEntityInput(event.target.value)}
              placeholder={t('graphPanel.workbench.merge.manual.placeholders.targetEntity')}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="shrink-0"
              tooltip={
                focusableTargetEntity
                  ? t('graphPanel.workbench.merge.manual.actions.focusTarget', {
                      entity: focusableTargetEntity
                    })
                  : t('graphPanel.workbench.merge.manual.actions.focusTargetEmpty')
              }
              onClick={() => navigateToEntity(focusableTargetEntity)}
              disabled={!focusableTargetEntity}
            >
              <LocateFixedIcon />
            </Button>
          </div>
        </div>

        <div className="text-muted-foreground rounded-md border border-dashed px-2 py-2 text-[11px]">
          {t('graphPanel.workbench.merge.manual.preview', {
            sourceEntities: draftPreview.sourceEntities.join(', '),
            targetEntity:
              draftPreview.targetEntity || t('graphPanel.workbench.merge.manual.targetRequired')
          })}
        </div>

        {errorMessage && <p className="text-xs text-red-600 dark:text-red-300">{errorMessage}</p>}

        <div className="rounded-md border border-dashed px-2 py-2">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={useLlmSuggestions}
              onCheckedChange={(checked) => setUseLlmSuggestions(checked === true)}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-xs font-medium">
                {t('graphPanel.workbench.merge.options.useLlm.label')}
              </span>
              <span className="text-muted-foreground block text-[11px]">
                {t('graphPanel.workbench.merge.options.useLlm.description')}
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleLoadSuggestions}
            disabled={isLoadingSuggestions}
          >
            {isLoadingSuggestions
              ? t('graphPanel.workbench.merge.actions.loading')
              : t('graphPanel.workbench.merge.actions.loadSuggestions')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmitMerge || isSubmittingMerge}>
            {isSubmittingMerge
              ? t('graphPanel.workbench.merge.actions.merging')
              : t('graphPanel.workbench.merge.actions.mergeEntities')}
          </Button>
        </div>
      </form>

      <MergeSuggestionList
        candidates={mergeCandidates}
        selectedTargets={selectedMergeCandidateTargets}
        isLoading={isLoadingSuggestions}
        errorMessage={suggestionError}
        noticeMessage={suggestionNotice}
        onImportCandidate={handleImportCandidate}
      />

      {mergeFollowUp && (
        <section className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            {t('graphPanel.workbench.merge.followUp.title', {
              sourceEntities: mergeFollowUp.sourceEntities.join(', '),
              targetEntity: mergeFollowUp.targetEntity
            })}
          </p>
          <p className="text-muted-foreground text-[11px]">
            {t('graphPanel.workbench.merge.followUp.description')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => handlePostMergeAction('focus_target')}
            >
              {t('graphPanel.workbench.merge.followUp.actions.focusTarget')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => handlePostMergeAction('refresh_results')}
            >
              {t('graphPanel.workbench.merge.followUp.actions.refreshResults')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => handlePostMergeAction('continue_review')}
            >
              {t('graphPanel.workbench.merge.followUp.actions.continueReview')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

export default MergeEntityPanel
