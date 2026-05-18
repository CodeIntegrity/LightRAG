import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, CopyIcon, Info } from 'lucide-react'

import type { DocStatusResponse, DocumentChunkResponse } from '@/api/lightrag'
import { getDocumentChunks } from '@/api/lightrag'
import Button from '@/components/ui/Button'
import MarkdownContent, { DEFAULT_MARKDOWN_CONTENT_CLASSNAME } from '@/components/ui/MarkdownContent'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/Dialog'
import { copyToClipboard } from '@/utils/clipboard'
import { errorMessage } from '@/lib/utils'
import { getDocumentDetailsCopyContent, shouldLoadDocumentChunks } from '@/features/documentChunks'
import { formatDocumentDetails } from '@/features/documentDetails'

export default function DocumentStatusDetailsDialog({ doc }: { doc: DocStatusResponse }) {
  const { t } = useTranslation()
  const details = formatDocumentDetails(doc)
  const hasDetailsContent = details.trim().length > 0
  const [open, setOpen] = useState(false)
  const [chunks, setChunks] = useState<DocumentChunkResponse[]>([])
  const [isLoadingChunks, setIsLoadingChunks] = useState(false)
  const [chunksError, setChunksError] = useState<string | null>(null)
  const shouldShowChunks = shouldLoadDocumentChunks(doc)

  const openLabel = t('documentPanel.documentManager.details.openTooltip', {
    defaultValue: 'View document details'
  })
  const detailsCopyLabel = shouldShowChunks
    ? t('documentPanel.documentManager.details.copyChunksTooltip', {
      defaultValue: 'Copy chunks'
    })
    : t('documentPanel.documentManager.details.copyTooltip', {
      defaultValue: 'Copy details'
    })

  useEffect(() => {
    if (!open || !shouldShowChunks) {
      return
    }

    let cancelled = false

    const loadChunks = async () => {
      setIsLoadingChunks(true)
      setChunksError(null)

      try {
        const response = await getDocumentChunks(doc.id)
        if (cancelled) {
          return
        }
        setChunks([...response.chunks].sort((left, right) => left.order - right.order))
      } catch (err) {
        if (cancelled) {
          return
        }
        const message = errorMessage(err)
        setChunks([])
        setChunksError(message)
        toast.error(
          t('documentPanel.documentManager.details.chunksLoadFailed', {
            defaultValue: 'Failed to load document chunks\n{{error}}',
            error: message
          })
        )
      } finally {
        if (!cancelled) {
          setIsLoadingChunks(false)
        }
      }
    }

    void loadChunks()

    return () => {
      cancelled = true
    }
  }, [doc.id, open, shouldShowChunks, t])

  const copyFeedback = async (
    text: string,
    successKey: string,
    failureKey: string,
    successDefault: string,
    failureDefault: string
  ) => {
    const result = await copyToClipboard(text)

    if (result.success) {
      toast.success(t(successKey, { defaultValue: successDefault }))
    } else {
      toast.error(t(failureKey, { defaultValue: failureDefault }))
    }
  }

  const handleCopy = async () => {
    await copyFeedback(
      getDocumentDetailsCopyContent({
        status: doc.status,
        details,
        chunks
      }),
      shouldShowChunks
        ? 'documentPanel.documentManager.details.copyChunksSuccess'
        : 'documentPanel.documentManager.details.copySuccess',
      shouldShowChunks
        ? 'documentPanel.documentManager.details.copyChunksFailed'
        : 'documentPanel.documentManager.details.copyFailed',
      shouldShowChunks ? 'Chunk content copied' : 'Status details copied',
      shouldShowChunks ? 'Failed to copy chunk content' : 'Failed to copy status details'
    )
  }

  const handleCopyChunk = async (chunk: DocumentChunkResponse) => {
    await copyFeedback(
      chunk.content,
      'documentPanel.documentManager.details.copyChunkSuccess',
      'documentPanel.documentManager.details.copyChunkFailed',
      'Chunk text copied',
      'Failed to copy chunk text'
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-2 size-7"
          tooltip={openLabel}
          side="top"
          aria-label={openLabel}
        >
          {doc.error_msg ? (
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          ) : (
            <Info className="h-4 w-4 text-blue-500" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {t('documentPanel.documentManager.details.title', {
              defaultValue: 'Document details'
            })}
          </DialogTitle>
          <DialogDescription className="break-all">
            {doc.id}
          </DialogDescription>
        </DialogHeader>

        <div className="relative rounded-md border bg-muted/30">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 size-7 bg-background/80 hover:bg-accent"
            onClick={handleCopy}
            tooltip={detailsCopyLabel}
            side="left"
            aria-label={detailsCopyLabel}
            disabled={shouldShowChunks ? isLoadingChunks || chunks.length === 0 : !hasDetailsContent}
          >
            <CopyIcon className="h-4 w-4" />
          </Button>
          <div className="max-h-[60vh] overflow-y-auto p-3 pr-12">
            {shouldShowChunks ? (
              isLoadingChunks ? (
                <p className="text-sm text-muted-foreground">
                  {t('documentPanel.documentManager.details.loadingChunks', {
                    defaultValue: 'Loading chunks...'
                  })}
                </p>
              ) : chunksError ? (
                <pre className="whitespace-pre-wrap break-words text-sm text-red-600">{chunksError}</pre>
              ) : chunks.length > 0 ? (
                <div className="space-y-3">
                  {chunks.map((chunk, index) => (
                    <div key={chunk.id} className="rounded-md border bg-background p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {t('documentPanel.documentManager.details.chunkLabel', {
                              defaultValue: 'Chunk {{index}}',
                              index: index + 1
                            })}
                          </div>
                          <div className="text-xs text-muted-foreground break-all">{chunk.id}</div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => void handleCopyChunk(chunk)}
                          tooltip={t('documentPanel.documentManager.details.copyChunkTooltip', {
                            defaultValue: 'Copy chunk text'
                          })}
                          side="left"
                          aria-label={t('documentPanel.documentManager.details.copyChunkTooltip', {
                            defaultValue: 'Copy chunk text'
                          })}
                        >
                          <CopyIcon className="h-4 w-4" />
                        </Button>
                      </div>
                      <MarkdownContent
                        content={chunk.content}
                        className={DEFAULT_MARKDOWN_CONTENT_CLASSNAME}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('documentPanel.documentManager.details.noChunks', {
                    defaultValue: 'No chunk content available.'
                  })}
                </p>
              )
            ) : hasDetailsContent ? (
              <pre className="whitespace-pre-wrap break-words text-sm">{details}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('documentPanel.documentManager.details.noDetails', {
                  defaultValue: 'No status details available.'
                })}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
