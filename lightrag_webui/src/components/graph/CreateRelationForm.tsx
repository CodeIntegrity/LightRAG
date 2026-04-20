import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getPopularLabels, searchLabels, createGraphRelation } from '@/api/lightrag'
import Button from '@/components/ui/Button'
import { AsyncSelect } from '@/components/ui/AsyncSelect'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { useGraphStore } from '@/stores/graph'
import {
  normalizeWorkbenchMutationError,
  useGraphWorkbenchStore
} from '@/stores/graphWorkbench'
import type { ActionInspectorSelection } from './ActionInspector'

export type CreateRelationDraft = {
  sourceEntity: string
  targetEntity: string
  description: string
  keywords: string
  weight: string
}

export const getDefaultCreateRelationDraft = (): CreateRelationDraft => {
  return {
    sourceEntity: '',
    targetEntity: '',
    description: '',
    keywords: '',
    weight: '1'
  }
}

export const fetchCreateRelationEntityOptions = async (query?: string): Promise<string[]> => {
  const normalizedQuery = query?.trim() ?? ''
  if (!normalizedQuery) {
    return await getPopularLabels()
  }
  return await searchLabels(normalizedQuery)
}

export const resolveCreateRelationSelectionFill = (
  selection: ActionInspectorSelection | null | undefined,
  activeField: 'source' | 'target' | null
): Partial<Pick<CreateRelationDraft, 'sourceEntity' | 'targetEntity'>> | null => {
  if (!selection || selection.kind !== 'node' || !activeField) {
    return null
  }

  const entityId = String(selection.node.properties?.entity_id ?? selection.node.id ?? '').trim()
  if (!entityId) {
    return null
  }

  return activeField === 'source'
    ? { sourceEntity: entityId }
    : { targetEntity: entityId }
}

type CreateRelationFormProps = {
  selection?: ActionInspectorSelection | null
}

const CreateRelationForm = ({ selection = null }: CreateRelationFormProps) => {
  const { t } = useTranslation()
  const [sourceEntity, setSourceEntity] = useState('')
  const [targetEntity, setTargetEntity] = useState('')
  const [description, setDescription] = useState('')
  const [keywords, setKeywords] = useState('')
  const [weight, setWeight] = useState('1')
  const [activeField, setActiveField] = useState<'source' | 'target' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const setMutationError = useGraphWorkbenchStore.use.setMutationError()
  const clearMutationError = useGraphWorkbenchStore.use.clearMutationError()
  const requestRefresh = useGraphWorkbenchStore.use.requestRefresh()

  useEffect(() => {
    const fill = resolveCreateRelationSelectionFill(selection, activeField)
    if (!fill) {
      return
    }

    if (typeof fill.sourceEntity === 'string') {
      setSourceEntity(fill.sourceEntity)
    }
    if (typeof fill.targetEntity === 'string') {
      setTargetEntity(fill.targetEntity)
    }
  }, [selection])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const source = sourceEntity.trim()
    const target = targetEntity.trim()
    if (!source || !target) {
      const message = t('graphPanel.workbench.createRelation.errors.required')
      setErrorMessage(message)
      setMutationError(message, false)
      return
    }

    if (source === target) {
      const message = t('graphPanel.workbench.createRelation.errors.sameEntity')
      setErrorMessage(message)
      setMutationError(message, false)
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)
    clearMutationError()

    const relationData: Record<string, unknown> = {}
    const trimmedDescription = description.trim()
    if (trimmedDescription) {
      relationData.description = trimmedDescription
    }
    const trimmedKeywords = keywords.trim()
    if (trimmedKeywords) {
      relationData.keywords = trimmedKeywords
    }
    const trimmedWeight = weight.trim()
    if (trimmedWeight) {
      const parsedWeight = Number(trimmedWeight)
      if (Number.isFinite(parsedWeight)) {
        relationData.weight = parsedWeight
      }
    }

    try {
      await createGraphRelation(source, target, relationData)
      toast.success(t('graphPanel.workbench.createRelation.messages.created', { source, target }))
      setDescription('')
      setKeywords('')
      setWeight('1')
      useGraphStore.getState().setGraphDataFetchAttempted(false)
      requestRefresh()
      useGraphStore.getState().incrementGraphDataVersion()
    } catch (error) {
      const normalized = normalizeWorkbenchMutationError(
        error,
        t('graphPanel.workbench.createRelation.errors.createFailed')
      )
      setErrorMessage(normalized.message)
      setMutationError(normalized.message, normalized.isConflict)
      toast.error(normalized.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-background/60 space-y-3 rounded-lg border p-3">
      <div>
        <h3 className="text-sm font-semibold">{t('graphPanel.workbench.createRelation.title')}</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('graphPanel.workbench.createRelation.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
            {t('graphPanel.workbench.createRelation.fields.source')}
          </label>
          <AsyncSelect<string>
            className="w-[var(--radix-popover-trigger-width)] min-w-[240px]"
            triggerClassName="w-full min-w-0 justify-between overflow-hidden"
            fetcher={fetchCreateRelationEntityOptions}
            onBeforeOpen={() => setActiveField('source')}
            renderOption={(item) => (
              <div className="truncate" title={item}>
                {item}
              </div>
            )}
            getOptionValue={(item) => item}
            getDisplayValue={(item) => (
              <div className="min-w-0 flex-1 truncate text-left" title={item}>
                {item}
              </div>
            )}
            ariaLabel={t('graphPanel.workbench.createRelation.fields.source')}
            placeholder={t('graphPanel.workbench.createRelation.placeholders.source')}
            searchPlaceholder={t('graphPanel.workbench.createRelation.placeholders.searchEntity')}
            noResultsMessage={t('graphPanel.workbench.createRelation.messages.noEntityResults')}
            value={sourceEntity}
            onChange={(value) => setSourceEntity(value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
            {t('graphPanel.workbench.createRelation.fields.target')}
          </label>
          <AsyncSelect<string>
            className="w-[var(--radix-popover-trigger-width)] min-w-[240px]"
            triggerClassName="w-full min-w-0 justify-between overflow-hidden"
            fetcher={fetchCreateRelationEntityOptions}
            onBeforeOpen={() => setActiveField('target')}
            renderOption={(item) => (
              <div className="truncate" title={item}>
                {item}
              </div>
            )}
            getOptionValue={(item) => item}
            getDisplayValue={(item) => (
              <div className="min-w-0 flex-1 truncate text-left" title={item}>
                {item}
              </div>
            )}
            ariaLabel={t('graphPanel.workbench.createRelation.fields.target')}
            placeholder={t('graphPanel.workbench.createRelation.placeholders.target')}
            searchPlaceholder={t('graphPanel.workbench.createRelation.placeholders.searchEntity')}
            noResultsMessage={t('graphPanel.workbench.createRelation.messages.noEntityResults')}
            value={targetEntity}
            onChange={(value) => setTargetEntity(value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
          {t('graphPanel.workbench.createRelation.fields.description')}
        </label>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('graphPanel.workbench.createRelation.placeholders.description')}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
            {t('graphPanel.workbench.createRelation.fields.keywords')}
          </label>
          <Input
            className="w-full"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder={t('graphPanel.workbench.createRelation.placeholders.keywords')}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
            {t('graphPanel.workbench.createRelation.fields.weight')}
          </label>
          <Input className="w-full" value={weight} onChange={(event) => setWeight(event.target.value)} type="number" step="0.1" />
        </div>
      </div>

      {errorMessage && <p className="text-xs text-red-600 dark:text-red-300">{errorMessage}</p>}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting
            ? t('graphPanel.workbench.createRelation.actions.creating')
            : t('graphPanel.workbench.createRelation.actions.create')}
        </Button>
      </div>
    </form>
  )
}

export default CreateRelationForm
