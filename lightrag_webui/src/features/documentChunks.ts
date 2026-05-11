import type { DocStatus, DocumentChunkResponse } from '@/api/lightrag'

export const formatDocumentChunksForCopy = (
  chunks: DocumentChunkResponse[]
): string =>
  chunks
    .map((chunk, index) => [`[${index + 1}] ${chunk.id}`, chunk.content].join('\n'))
    .join('\n\n')

export const shouldLoadDocumentChunks = (
  doc: Pick<{ status: DocStatus }, 'status'>
): boolean => doc.status === 'processed'

export const getDocumentDetailsCopyContent = ({
  status,
  details,
  chunks
}: {
  status: DocStatus
  details: string
  chunks: DocumentChunkResponse[]
}): string => (shouldLoadDocumentChunks({ status }) ? formatDocumentChunksForCopy(chunks) : details)
