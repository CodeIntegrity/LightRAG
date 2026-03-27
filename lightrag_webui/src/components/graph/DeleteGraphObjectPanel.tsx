import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/AlertDialog'
import { deleteGraphEntity, deleteGraphRelation } from '@/api/lightrag'
import { useGraphStore } from '@/stores/graph'
import {
  normalizeWorkbenchMutationError,
  useGraphWorkbenchStore
} from '@/stores/graphWorkbench'
import type { ActionInspectorSelection } from './ActionInspector'

export type DeletePanelState = {
  confirmationInput: string
  errorMessage: string | null
}

type DeleteCopyTranslator = (key: string, options?: Record<string, unknown>) => string
type DeleteDialogDetails = {
  title: string
  description: string
  items: Array<{ label: string; value: string }>
}

export const buildDeleteConfirmationCopy = (
  selection: ActionInspectorSelection | null | undefined,
  t?: DeleteCopyTranslator
): string => {
  const translate = (key: string, options?: Record<string, unknown>): string => {
    if (t) {
      return t(key, options)
    }
    return key
  }

  if (!selection) {
    return t
      ? translate('graphPanel.workbench.deleteObject.confirmation.emptySelection')
      : 'Select a node or relation first.'
  }

  if (selection.kind === 'node') {
    const entityName = String(selection.node.properties?.entity_id ?? selection.node.id)
    return t
      ? translate('graphPanel.workbench.deleteObject.confirmation.node', { entity: entityName })
      : `You are deleting entity "${entityName}". Related relations will also be removed.`
  }

  const source = String(
    selection.edge.sourceNode?.properties?.entity_id ?? selection.edge.source
  )
  const target = String(
    selection.edge.targetNode?.properties?.entity_id ?? selection.edge.target
  )
  const summary = selection.edge.type || selection.edge.properties?.keywords
  if (summary) {
    return t
      ? translate('graphPanel.workbench.deleteObject.confirmation.relationWithSummary', {
          source,
          target,
          summary
        })
      : `You are deleting relation "${source} -> ${target}" (${summary}).`
  }
  return t
    ? translate('graphPanel.workbench.deleteObject.confirmation.relation', { source, target })
    : `You are deleting relation "${source} -> ${target}".`
}

export const reduceDeletePanelStateAfterFailure = (
  state: DeletePanelState,
  message: string
): DeletePanelState => ({
  ...state,
  errorMessage: message
})

export const buildDeleteDialogDetails = (
  selection: ActionInspectorSelection | null | undefined,
  t?: DeleteCopyTranslator
): DeleteDialogDetails => {
  const translate = (key: string, options?: Record<string, unknown>): string => {
    if (t) {
      return t(key, options)
    }
    return key
  }

  if (!selection) {
    return {
      title: t
        ? translate('graphPanel.workbench.deleteObject.dialog.emptyTitle')
        : 'No selection',
      description: buildDeleteConfirmationCopy(selection, t),
      items: []
    }
  }

  if (selection.kind === 'node') {
    const entityName = String(selection.node.properties?.entity_id ?? selection.node.id)
    const description = String(selection.node.properties?.description ?? '').trim()
    const items = [
      {
        label: t
          ? translate('graphPanel.workbench.deleteObject.fields.entity')
          : 'Entity',
        value: entityName
      }
    ]
    if (description) {
      items.push({
        label: t
          ? translate('graphPanel.workbench.deleteObject.fields.description')
          : 'Description',
        value: description
      })
    }
    return {
      title: t
        ? translate('graphPanel.workbench.deleteObject.dialog.nodeTitle', {
            entity: entityName
          })
        : `Delete entity "${entityName}"`,
      description: buildDeleteConfirmationCopy(selection, t),
      items
    }
  }

  const source = String(
    selection.edge.sourceNode?.properties?.entity_id ?? selection.edge.source
  )
  const target = String(
    selection.edge.targetNode?.properties?.entity_id ?? selection.edge.target
  )
  const summary = String(
    selection.edge.type || selection.edge.properties?.keywords || selection.edge.properties?.description || ''
  ).trim()

  const items = [
    {
      label: t
        ? translate('graphPanel.workbench.deleteObject.fields.source')
        : 'Source',
      value: source
    },
    {
      label: t
        ? translate('graphPanel.workbench.deleteObject.fields.target')
        : 'Target',
      value: target
    }
  ]
  if (summary) {
    items.push({
      label: t
        ? translate('graphPanel.workbench.deleteObject.fields.summary')
        : 'Summary',
      value: summary
    })
  }

  return {
    title: t
      ? translate('graphPanel.workbench.deleteObject.dialog.relationTitle', {
          source,
          target
        })
      : `Delete relation "${source} -> ${target}"`,
    description: buildDeleteConfirmationCopy(selection, t),
    items
  }
}

type DeleteGraphObjectPanelProps = {
  selection?: ActionInspectorSelection | null
}

const DeleteGraphObjectPanel = ({ selection = null }: DeleteGraphObjectPanelProps) => {
  const { t } = useTranslation()
  const [state, setState] = useState<DeletePanelState>({
    confirmationInput: '',
    errorMessage: null
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const setMutationError = useGraphWorkbenchStore.use.setMutationError()
  const clearMutationError = useGraphWorkbenchStore.use.clearMutationError()
  const requestRefresh = useGraphWorkbenchStore.use.requestRefresh()

  const confirmationCopy = useMemo(() => buildDeleteConfirmationCopy(selection, t), [selection, t])
  const dialogDetails = useMemo(() => buildDeleteDialogDetails(selection, t), [selection, t])

  useEffect(() => {
    setState((prev) => ({ ...prev, errorMessage: null }))
    setDialogOpen(false)
  }, [selection])

  const executeDelete = async () => {
    if (!selection || isSubmitting) return

    setIsSubmitting(true)
    clearMutationError()
    setState((prev) => ({ ...prev, errorMessage: null }))

    try {
      if (selection.kind === 'node') {
        const entityName = String(selection.node.properties?.entity_id ?? selection.node.id)
        await deleteGraphEntity(entityName)
        toast.success(t('graphPanel.workbench.deleteObject.messages.entityDeleted', { entity: entityName }))
      } else {
        const source = String(
          selection.edge.sourceNode?.properties?.entity_id ?? selection.edge.source
        )
        const target = String(
          selection.edge.targetNode?.properties?.entity_id ?? selection.edge.target
        )
        await deleteGraphRelation(source, target, selection.edge.revision_token)
        toast.success(t('graphPanel.workbench.deleteObject.messages.relationDeleted', { source, target }))
      }

      setState({ confirmationInput: '', errorMessage: null })
      setDialogOpen(false)
      useGraphStore.getState().setGraphDataFetchAttempted(false)
      requestRefresh()
      useGraphStore.getState().incrementGraphDataVersion()
    } catch (error) {
      const normalized = normalizeWorkbenchMutationError(
        error,
        t('graphPanel.workbench.deleteObject.errors.deleteFailed')
      )
      setState((prev) => reduceDeletePanelStateAfterFailure(prev, normalized.message))
      setMutationError(normalized.message, normalized.isConflict)
      toast.error(normalized.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="bg-background/60 space-y-3 rounded-lg border p-3">
      <div>
        <h3 className="text-sm font-semibold">{t('graphPanel.workbench.deleteObject.title')}</h3>
        <p className="text-muted-foreground mt-1 text-xs">{confirmationCopy}</p>
      </div>

      {state.errorMessage && <p className="text-xs text-red-600 dark:text-red-300">{state.errorMessage}</p>}

      <div className="flex justify-end">
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!selection || isSubmitting}
            onClick={() => setDialogOpen(true)}
          >
            {isSubmitting
              ? t('graphPanel.workbench.deleteObject.actions.deleting')
              : t('graphPanel.workbench.deleteObject.actions.delete')}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{dialogDetails.title}</AlertDialogTitle>
              <AlertDialogDescription>{dialogDetails.description}</AlertDialogDescription>
            </AlertDialogHeader>

            {!!dialogDetails.items.length && (
              <div className="space-y-2 rounded-md border p-3">
                {dialogDetails.items.map((item) => (
                  <div key={`${item.label}:${item.value}`} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 text-sm">
                    <span className="text-muted-foreground font-medium">{item.label}</span>
                    <span className="break-words">{item.value}</span>
                  </div>
                ))}
              </div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel>
                {t('graphPanel.workbench.deleteObject.actions.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async (event) => {
                  event.preventDefault()
                  await executeDelete()
                }}
              >
                {isSubmitting
                  ? t('graphPanel.workbench.deleteObject.actions.deleting')
                  : t('graphPanel.workbench.deleteObject.actions.confirmDelete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

export default DeleteGraphObjectPanel
