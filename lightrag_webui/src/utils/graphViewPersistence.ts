const STORAGE_PREFIX = 'lightrag-graph-view:'
const MAX_ENTRIES = 50
export const DEFAULT_GRAPH_LAYOUT = 'Circular'
export const SUPPORTED_GRAPH_LAYOUTS = [
  'Circular',
  'Circlepack',
  'Random',
  'Noverlaps',
  'Force Directed',
  'Force Atlas'
] as const

export type SupportedGraphLayout = (typeof SUPPORTED_GRAPH_LAYOUTS)[number]

export interface PersistedLayoutParams {
  repulsion: number
  gravity: number
  margin: number
  maxIterations: number
  attraction: number
  inertia: number
  maxMove: number
  expansion: number
  gridSize: number
  ratio: number
  speed: number
}

export const DEFAULT_LAYOUT_PARAMS: PersistedLayoutParams = {
  repulsion: 0.02,
  gravity: 0.02,
  margin: 5,
  maxIterations: 15,
  attraction: 0.0003,
  inertia: 0.4,
  maxMove: 100,
  expansion: 1.1,
  gridSize: 1,
  ratio: 1,
  speed: 3
}

export interface PersistedGraphView {
  nodePositions: Record<string, { x: number; y: number }>
  layoutType: string
  layoutParams: PersistedLayoutParams
  cameraView?: { x: number; y: number; ratio: number }
  savedAt: number
}

export interface GraphNodePosition {
  id: string
  x: number
  y: number
}

export interface GraphCameraStateSnapshot {
  x: number
  y: number
  ratio: number
}

export interface GraphCameraController {
  getState: () => GraphCameraStateSnapshot & Record<string, unknown>
  setState: (state: GraphCameraStateSnapshot & Record<string, unknown>) => void
  on: (event: 'updated', listener: () => void) => void
  off: (event: 'updated', listener: () => void) => void
}

export interface GraphViewContext {
  workspace: string
  queryLabel: string | null | undefined
}

export interface GraphLayoutSettingsApplier {
  setGraphLayoutRepulsion: (value: number) => void
  setGraphLayoutGravity: (value: number) => void
  setGraphLayoutMargin: (value: number) => void
  setGraphLayoutMaxIterations: (value: number) => void
  setGraphLayoutAttraction: (value: number) => void
  setGraphLayoutInertia: (value: number) => void
  setGraphLayoutMaxMove: (value: number) => void
  setGraphLayoutExpansion: (value: number) => void
  setGraphLayoutGridSize: (value: number) => void
  setGraphLayoutRatio: (value: number) => void
  setGraphLayoutSpeed: (value: number) => void
}

export interface GraphLayoutSettingsSnapshot {
  graphLayoutRepulsion: number
  graphLayoutGravity: number
  graphLayoutMargin: number
  graphLayoutMaxIterations: number
  graphLayoutAttraction: number
  graphLayoutInertia: number
  graphLayoutMaxMove: number
  graphLayoutExpansion: number
  graphLayoutGridSize: number
  graphLayoutRatio: number
  graphLayoutSpeed: number
}

export function isSupportedGraphLayout(layoutType: string): layoutType is SupportedGraphLayout {
  return SUPPORTED_GRAPH_LAYOUTS.includes(layoutType as SupportedGraphLayout)
}

function resolvePersistedLayoutType(
  layoutType: string | null | undefined
): SupportedGraphLayout {
  return layoutType && isSupportedGraphLayout(layoutType)
    ? layoutType
    : DEFAULT_GRAPH_LAYOUT
}

export function buildGraphViewKey(workspace: string, queryLabel: string): string {
  const normalizedWorkspace = workspace || 'default'
  const normalizedLabel = queryLabel || '*'
  return `${normalizedWorkspace}::${normalizedLabel}`
}

export function resolveGraphViewKey(context: GraphViewContext): string {
  return buildGraphViewKey(context.workspace, context.queryLabel || '*')
}

function buildLayoutParamsFromSettings(
  settings: GraphLayoutSettingsSnapshot
): PersistedLayoutParams {
  return {
    repulsion: settings.graphLayoutRepulsion,
    gravity: settings.graphLayoutGravity,
    margin: settings.graphLayoutMargin,
    maxIterations: settings.graphLayoutMaxIterations,
    attraction: settings.graphLayoutAttraction,
    inertia: settings.graphLayoutInertia,
    maxMove: settings.graphLayoutMaxMove,
    expansion: settings.graphLayoutExpansion,
    gridSize: settings.graphLayoutGridSize,
    ratio: settings.graphLayoutRatio,
    speed: settings.graphLayoutSpeed
  }
}

function buildCameraViewFromState(
  cameraState: GraphCameraStateSnapshot
): NonNullable<PersistedGraphView['cameraView']> {
  return {
    x: cameraState.x,
    y: cameraState.y,
    ratio: cameraState.ratio
  }
}

export function restorePersistedCameraView(
  camera: GraphCameraController,
  cameraView: NonNullable<PersistedGraphView['cameraView']>
): void {
  camera.setState({
    ...camera.getState(),
    ...cameraView
  })
}

export function subscribeToCameraViewPersistence(
  camera: GraphCameraController,
  context: GraphViewContext,
  delayMs: number = 120
): () => void {
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const persistCameraView = () => {
    if (persistTimer) {
      clearTimeout(persistTimer)
    }
    persistTimer = setTimeout(() => {
      saveGraphCameraView(context, camera.getState())
    }, delayMs)
  }

  camera.on('updated', persistCameraView)

  return () => {
    if (persistTimer) {
      clearTimeout(persistTimer)
    }
    camera.off('updated', persistCameraView)
  }
}

function buildNodePositionPatch(
  nodeId: string,
  x: number,
  y: number
): Pick<PersistedGraphView, 'nodePositions'> {
  return {
    nodePositions: {
      [nodeId]: { x, y }
    }
  }
}

export function saveGraphLayoutView(
  context: GraphViewContext,
  layoutType: string,
  settings: GraphLayoutSettingsSnapshot
): void {
  saveGraphViewForContext(context, {
    layoutType,
    layoutParams: buildLayoutParamsFromSettings(settings)
  })
}

export function saveGraphLayoutSettings(
  context: GraphViewContext,
  settings: GraphLayoutSettingsSnapshot
): void {
  saveGraphViewForContext(context, {
    layoutParams: buildLayoutParamsFromSettings(settings)
  })
}

export function saveGraphCameraView(
  context: GraphViewContext,
  cameraState: GraphCameraStateSnapshot
): void {
  saveGraphViewForContext(context, {
    cameraView: buildCameraViewFromState(cameraState)
  })
}

export function saveGraphNodePosition(
  context: GraphViewContext,
  nodeId: string,
  x: number,
  y: number
): void {
  saveGraphViewForContext(context, buildNodePositionPatch(nodeId, x, y))
}

export function loadGraphLayoutType(context: GraphViewContext): SupportedGraphLayout {
  return resolvePersistedLayoutType(loadGraphViewForContext(context)?.layoutType)
}

export function loadGraphLayoutParams(
  context: GraphViewContext
): PersistedGraphView['layoutParams'] | null {
  return loadGraphViewForContext(context)?.layoutParams ?? null
}

export function loadGraphCameraView(
  context: GraphViewContext
): PersistedGraphView['cameraView'] | null {
  return loadGraphViewForContext(context)?.cameraView ?? null
}

export function loadGraphNodePositions(
  context: GraphViewContext
): PersistedGraphView['nodePositions'] {
  return loadGraphViewForContext(context)?.nodePositions ?? {}
}

export function applyPersistedNodePositions(
  nodes: GraphNodePosition[],
  nodePositions: PersistedGraphView['nodePositions']
): void {
  for (const node of nodes) {
    const pos = nodePositions[node.id]
    if (pos) {
      node.x = pos.x
      node.y = pos.y
    }
  }
}

export function applyPersistedLayoutParams(
  layoutParams: Partial<PersistedLayoutParams>,
  settings: GraphLayoutSettingsApplier
): void {
  if (layoutParams.repulsion !== undefined) settings.setGraphLayoutRepulsion(layoutParams.repulsion)
  if (layoutParams.gravity !== undefined) settings.setGraphLayoutGravity(layoutParams.gravity)
  if (layoutParams.margin !== undefined) settings.setGraphLayoutMargin(layoutParams.margin)
  if (layoutParams.maxIterations !== undefined) {
    settings.setGraphLayoutMaxIterations(layoutParams.maxIterations)
  }
  if (layoutParams.attraction !== undefined) {
    settings.setGraphLayoutAttraction(layoutParams.attraction)
  }
  if (layoutParams.inertia !== undefined) settings.setGraphLayoutInertia(layoutParams.inertia)
  if (layoutParams.maxMove !== undefined) settings.setGraphLayoutMaxMove(layoutParams.maxMove)
  if (layoutParams.expansion !== undefined) settings.setGraphLayoutExpansion(layoutParams.expansion)
  if (layoutParams.gridSize !== undefined) settings.setGraphLayoutGridSize(layoutParams.gridSize)
  if (layoutParams.ratio !== undefined) settings.setGraphLayoutRatio(layoutParams.ratio)
  if (layoutParams.speed !== undefined) settings.setGraphLayoutSpeed(layoutParams.speed)
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
      layoutType: data.layoutType ?? existing?.layoutType ?? DEFAULT_GRAPH_LAYOUT,
      layoutParams: {
        ...(existing?.layoutParams ?? DEFAULT_LAYOUT_PARAMS),
        ...(data.layoutParams ?? {})
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

export function saveGraphViewForContext(
  context: GraphViewContext,
  data: Partial<PersistedGraphView>
): void {
  saveGraphView(resolveGraphViewKey(context), data)
}

export function loadGraphView(viewKey: string): PersistedGraphView | null {
  try {
    const storageKey = getStorageKey(viewKey)
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedGraphView>
    if (!parsed.nodePositions || typeof parsed.savedAt !== 'number') {
      return null
    }
    return {
      nodePositions: parsed.nodePositions,
      layoutType: parsed.layoutType ?? DEFAULT_GRAPH_LAYOUT,
      layoutParams: {
        ...DEFAULT_LAYOUT_PARAMS,
        ...(parsed.layoutParams ?? {})
      },
      cameraView: parsed.cameraView,
      savedAt: parsed.savedAt
    }
  } catch (error) {
    console.warn('Failed to load graph view state:', error)
    return null
  }
}

export function loadGraphViewForContext(
  context: GraphViewContext
): PersistedGraphView | null {
  return loadGraphView(resolveGraphViewKey(context))
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
