const HIDDEN_PROPERTY_KEYS = new Set(['created_at', 'truncate', 'revision_token', 'graph_data'])
const HIDDEN_NODE_PROPERTY_KEYS = new Set(['name'])
const CUSTOM_PROPERTIES_KEY = 'custom_properties'

export type GraphPropertyEntry = {
  name: string
  value: unknown
}

export const isEmptyGraphPropertyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true
  }

  if (typeof value === 'string') {
    return value.trim() === ''
  }

  return false
}

export const getVisibleGraphPropertyKeys = (
  properties: Record<string, unknown>,
  type: 'node' | 'edge',
  options?: {
    hideKeywords?: boolean
  }
): string[] => {
  return getVisibleGraphPropertyEntries(properties, type, options).map(({ name }) => name)
}

export const getVisibleGraphPropertyEntries = (
  properties: Record<string, unknown>,
  type: 'node' | 'edge',
  options?: {
    hideKeywords?: boolean
  }
): GraphPropertyEntry[] => {
  const visibleNames = Object.keys(properties)
    .sort()
    .filter((name) => {
      if (name === CUSTOM_PROPERTIES_KEY || HIDDEN_PROPERTY_KEYS.has(name)) {
        return false
      }

      if (type === 'node' && HIDDEN_NODE_PROPERTY_KEYS.has(name)) {
        return false
      }

      if (type === 'edge' && options?.hideKeywords && name === 'keywords') {
        return false
      }

      return !isEmptyGraphPropertyValue(properties[name])
    })

  const entries: GraphPropertyEntry[] = visibleNames.map((name) => ({
    name,
    value: properties[name]
  }))
  const customProperties = properties[CUSTOM_PROPERTIES_KEY]
  if (!customProperties || Array.isArray(customProperties) || typeof customProperties !== 'object') {
    return entries
  }

  const seenNames = new Set(entries.map(({ name }) => name))
  for (const name of Object.keys(customProperties as Record<string, unknown>).sort()) {
    if (type === 'node' && HIDDEN_NODE_PROPERTY_KEYS.has(name)) {
      continue
    }
    if (seenNames.has(name)) {
      continue
    }
    const value = (customProperties as Record<string, unknown>)[name]
    if (isEmptyGraphPropertyValue(value)) {
      continue
    }
    entries.push({ name, value })
  }

  return entries
}
