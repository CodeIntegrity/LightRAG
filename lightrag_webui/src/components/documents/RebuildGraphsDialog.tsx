import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BoxesIcon } from 'lucide-react'
import { toast } from 'sonner'

import { rebuildCustomChunksGraph } from '@/api/lightrag'
import Button from '@/components/ui/Button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/AlertDialog'
import { errorMessage } from '@/lib/utils'

interface RebuildGraphsDialogProps {
  disabled?: boolean
  onGraphsRebuilt?: () => Promise<void>
  selectedDocIds: string[]
}

export default function RebuildGraphsDialog({
  disabled = false,
  onGraphsRebuilt,
  selectedDocIds
}: RebuildGraphsDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const selectedCount = selectedDocIds.length
  const hasSelection = selectedCount > 0

  const confirmationDescription = useMemo(
    () =>
      hasSelection
        ? t('documentPanel.documentManager.customChunksRebuild.confirmSelected', {
            count: selectedCount,
            defaultValue: '将重建选中的 {{count}} 个文件图谱'
          })
        : t('documentPanel.documentManager.customChunksRebuild.confirmAll', {
            defaultValue: '将重建全部图谱'
          }),
    [hasSelection, selectedCount, t]
  )

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    try {
      const response = await rebuildCustomChunksGraph(
        hasSelection ? selectedDocIds : undefined
      )

      if (response.status === 'busy') {
        toast.error(
          t(
            'documentPanel.documentManager.customChunksRebuild.busy',
            '当前有其他流水线任务正在运行'
          )
        )
        return
      }

      toast.success(
        hasSelection
          ? t('documentPanel.documentManager.customChunksRebuild.startedSelected', {
              count: selectedCount,
              defaultValue: '已开始重建选中的 {{count}} 个文件图谱'
            })
          : t(
              'documentPanel.documentManager.customChunksRebuild.started',
              '已开始重建全部图谱'
            )
      )

      if (onGraphsRebuilt) {
        await onGraphsRebuilt()
      }
      setOpen(false)
    } catch (err) {
      toast.error(
        t('documentPanel.documentManager.customChunksRebuild.failed', {
          defaultValue: '重建图谱失败\n{{error}}',
          error: errorMessage(err)
        })
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [hasSelection, isSubmitting, onGraphsRebuilt, selectedCount, selectedDocIds, t])

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          side="bottom"
          tooltip={t(
            'documentPanel.documentManager.customChunksRebuild.tooltip',
            '重建图谱'
          )}
          size="sm"
          disabled={disabled}
        >
          <BoxesIcon />{' '}
          {t(
            'documentPanel.documentManager.customChunksRebuild.button',
            '重建图谱'
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(
              'documentPanel.documentManager.customChunksRebuild.confirmTitle',
              '确认重建图谱'
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmationDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              void handleConfirm()
            }}
            disabled={isSubmitting}
          >
            {t(
              'documentPanel.documentManager.customChunksRebuild.confirmButton',
              '确认重建'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
