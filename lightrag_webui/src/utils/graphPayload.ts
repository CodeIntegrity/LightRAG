const RESERVED_NODE_KEYS = new Set([
  'id',
  'labels',
  'properties',
  'graph_data',
  'revision_token',
  'size',
  'x',
  'y',
  'color',
  'degree'
])

const RESERVED_EDGE_KEYS = new Set([
  'id',
  'source',
  'target',
  'type',
  'properties',
  'graph_data',
  'revision_token',
  'dynamicId'
])

const CUSTOM_PROPERTIES_KEY = 'custom_properties'

type NormalizedGraphNodePayload = Record<string, unknown> & {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

type NormalizedGraphEdgePayload = Record<string, unknown> & {
  id: string
  source: string
  target: string
  type?: string
  properties: Record<string, unknown>
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return {}
    }
    try {
      const parsed = JSON.parse(trimmed)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {}
    } catch {
      return {}
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

const mergeCustomProperties = (
  baseProperties: Record<string, unknown>,
  extraCustomProperties: unknown
): Record<string, unknown> => {
  const nestedCustomProperties = asRecord(baseProperties[CUSTOM_PROPERTIES_KEY])
  const topLevelCustomProperties = asRecord(extraCustomProperties)

  if (
    Object.keys(nestedCustomProperties).length === 0 &&
    Object.keys(topLevelCustomProperties).length === 0
  ) {
    return baseProperties
  }

  return {
    ...baseProperties,
    [CUSTOM_PROPERTIES_KEY]: {
      ...nestedCustomProperties,
      ...topLevelCustomProperties
    }
  }
}

const normalizeProperties = (
  payload: Record<string, unknown>,
  reservedKeys: Set<string>
): Record<string, unknown> => {
  const properties = mergeCustomProperties(
    asRecord(payload.properties),
    payload[CUSTOM_PROPERTIES_KEY]
  )

  for (const [key, value] of Object.entries(payload)) {
    if (reservedKeys.has(key) || key === CUSTOM_PROPERTIES_KEY) {
      continue
    }
    properties[key] = value
  }

  return properties
}

export const normalizeGraphNodePayload = (
  payload: Record<string, unknown>
): NormalizedGraphNodePayload => ({
  ...payload,
  id: String(payload.id ?? ''),
  labels: Array.isArray(payload.labels)
    ? payload.labels.filter((label): label is string => typeof label === 'string')
    : [],
  properties: normalizeProperties(payload, RESERVED_NODE_KEYS)
})

export const normalizeGraphEdgePayload = (
  payload: Record<string, unknown>
): NormalizedGraphEdgePayload => ({
  ...payload,
  id: String(payload.id ?? ''),
  source: String(payload.source ?? ''),
  target: String(payload.target ?? ''),
  type: typeof payload.type === 'string' ? payload.type : undefined,
  properties: normalizeProperties(payload, RESERVED_EDGE_KEYS)
})
