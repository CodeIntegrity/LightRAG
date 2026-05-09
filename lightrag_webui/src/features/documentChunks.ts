import type { DocumentChunkResponse } from '@/api/lightrag'

export const formatDocumentChunksForCopy = (
  chunks: DocumentChunkResponse[]
): string =>
  chunks
    .map((chunk, index) => [`[${index + 1}] ${chunk.id}`, chunk.content].join('\n'))
    .join('\n\n')
