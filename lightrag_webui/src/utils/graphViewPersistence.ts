const STORAGE_PREFIX = 'lightrag-graph-view:'
const MAX_ENTRIES = 50

export interface PersistedGraphView {
  nodePositions: Record<string, { x: number; y: number }>
  layoutType: string
  layoutParams: {
    repulsion: number
    gravity: number
    margin: number
    maxIterations: number
  }
  cameraView?: { x: number; y: number; ratio: number }
  savedAt: number
}

export function buildGraphViewKey(workspace: string, queryLabel: string): string {
  const normalizedWorkspace = workspace || 'default'
  const normalizedLabel = queryLabel || '*'
  return `${normalizedWorkspace}::${normalizedLabel}`
}

function getStorageKey(viewKey: string): string {
  return `${STORAGE_PREFIX}${viewKey}`
}

export function saveGraphView(
  viewKey: string,
  data: Partial<PersistedGraphView>
): void {
  try {
    const storageKey = getStorageKey(viewKey)
    const existing = loadGraphView(viewKey)
    const merged: PersistedGraphView = {
      nodePositions: {
        ...(existing?.nodePositions ?? {}),
        ...(data.nodePositions ?? {})
      },
      layoutType: data.layoutType ?? existing?.layoutType ?? 'Circular',
      layoutParams: data.layoutParams ?? existing?.layoutParams ?? {
        repulsion: 0.02,
        gravity: 0.02,
        margin: 5,
        maxIterations: 15
      },
      cameraView: data.cameraView ?? existing?.cameraView,
      savedAt: Date.now()
    }
    localStorage.setItem(storageKey, JSON.stringify(merged))
    pruneGraphViews(MAX_ENTRIES)
  } catch (error) {
    console.warn('Failed to save graph view state:', error)
  }
}

export function loadGraphView(viewKey: string): PersistedGraphView | null {
  try {
    const storageKey = getStorageKey(viewKey)
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedGraphView
    if (!parsed.nodePositions || typeof parsed.savedAt !== 'number') {
      return null
    }
    return parsed
  } catch (error) {
    console.warn('Failed to load graph view state:', error)
    return null
  }
}

export function clearGraphView(viewKey: string): void {
  try {
    const storageKey = getStorageKey(viewKey)
    localStorage.removeItem(storageKey)
  } catch (error) {
    console.warn('Failed to clear graph view state:', error)
  }
}

function getGraphViewKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keys.push(key)
    }
  }
  return keys
}

function pruneGraphViews(maxEntries: number = MAX_ENTRIES): void {
  try {
    const keys = getGraphViewKeys()
    if (keys.length <= maxEntries) return

    const entries = keys
      .map((key) => {
        try {
          const raw = localStorage.getItem(key)
          if (!raw) return { key, savedAt: 0 }
          const parsed = JSON.parse(raw) as PersistedGraphView
          return { key, savedAt: parsed.savedAt || 0 }
        } catch {
          return { key, savedAt: 0 }
        }
      })
      .sort((a, b) => a.savedAt - b.savedAt)

    const toRemove = entries.slice(0, entries.length - maxEntries)
    for (const entry of toRemove) {
      localStorage.removeItem(entry.key)
    }
  } catch (error) {
    console.warn('Failed to prune graph views:', error)
  }
}
