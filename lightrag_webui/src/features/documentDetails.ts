import type { DocStatusResponse } from '@/api/lightrag'

import { shouldLoadDocumentChunks } from './documentChunks'

const formatMetadata = (metadata: Record<string, any>): string => {
  const formattedMetadata = { ...metadata }

  if (formattedMetadata.processing_start_time && typeof formattedMetadata.processing_start_time === 'number') {
    const date = new Date(formattedMetadata.processing_start_time * 1000)
    if (!isNaN(date.getTime())) {
      formattedMetadata.processing_start_time = date.toLocaleString()
    }
  }

  if (formattedMetadata.processing_end_time && typeof formattedMetadata.processing_end_time === 'number') {
    const date = new Date(formattedMetadata.processing_end_time * 1000)
    if (!isNaN(date.getTime())) {
      formattedMetadata.processing_end_time = date.toLocaleString()
    }
  }

  const jsonStr = JSON.stringify(formattedMetadata, null, 2)
  const lines = jsonStr.split('\n')
  return lines.slice(1, -1)
    .map(line => line.replace(/^ {2}/, ''))
    .join('\n')
}

export const hasDocumentDetails = (doc: DocStatusResponse): boolean => {
  return Boolean(
    shouldLoadDocumentChunks(doc) ||
    (doc.chunks_count ?? 0) > 0 ||
    doc.track_id ||
    doc.error_msg ||
    (doc.metadata && Object.keys(doc.metadata).length > 0)
  )
}

export const formatDocumentDetails = (doc: DocStatusResponse): string => {
  const details: string[] = []

  if (doc.track_id) {
    details.push(`Track ID: ${doc.track_id}`)
  }

  if (doc.metadata && Object.keys(doc.metadata).length > 0) {
    details.push(formatMetadata(doc.metadata))
  }

  if (doc.error_msg) {
    details.push(`Error Message:\n${doc.error_msg}`)
  }

  return details.join('\n\n')
}
