type NodeDisplayCandidate = {
  id?: string
  labels?: string[]
  properties?: Record<string, unknown>
  name?: unknown
  custom_properties?: Record<string, unknown>
}

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export const resolveNodeDisplayName = (
  node: NodeDisplayCandidate | null | undefined
): string => {
  const topLevelName = asNonEmptyString(node?.name)
  if (topLevelName) {
    return topLevelName
  }

  const name = asNonEmptyString(node?.properties?.name)
  if (name) {
    return name
  }

  const customName = asNonEmptyString(
    node?.properties?.custom_properties &&
      typeof node.properties.custom_properties === 'object' &&
      !Array.isArray(node.properties.custom_properties)
      ? (node.properties.custom_properties as Record<string, unknown>).name
      : node?.custom_properties?.name
  )
  if (customName) {
    return customName
  }

  const entityId = asNonEmptyString(node?.properties?.entity_id)
  if (entityId) {
    return entityId
  }

  const firstLabel = node?.labels?.find(
    (label) => typeof label === 'string' && label.trim()
  )
  if (firstLabel) {
    return firstLabel
  }

  const id = asNonEmptyString(node?.id)
  return id ?? ''
}
