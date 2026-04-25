import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/ui/Button'
import { RawEdgeType, RawNodeType, useGraphStore } from '@/stores/graph'
import { useGraphWorkbenchStore } from '@/stores/graphWorkbench'

import CreateNodeForm from './CreateNodeForm'
import CreateRelationForm from './CreateRelationForm'
import DeleteGraphObjectPanel from './DeleteGraphObjectPanel'
import MergeEntityPanel from './MergeEntityPanel'
import PropertiesView from './PropertiesView'

export const ACTION_INSPECTOR_TABS = ['inspect', 'create', 'delete', 'merge'] as const

export type ActionInspectorTab = (typeof ACTION_INSPECTOR_TABS)[number]

export type ActionInspectorNode = RawNodeType & {
  revision_token?: string
}

export type ActionInspectorEdge = RawEdgeType & {
  revision_token?: string
  sourceNode?: RawNodeType
  targetNode?: RawNodeType
}

export type ActionInspectorSelection =
  | { kind: 'node'; node: ActionInspectorNode }
  | { kind: 'edge'; edge: ActionInspectorEdge }

type ActionInspectorProps = {
  initialTab?: ActionInspectorTab
  selection?: ActionInspectorSelection | null
}

const isActionInspectorTab = (value: string): value is ActionInspectorTab =>
  ACTION_INSPECTOR_TABS.some((tab) => tab === value)

export const resolveActionInspectorTab = (
  current: ActionInspectorTab,
  next: string
): ActionInspectorTab => (isActionInspectorTab(next) ? next : current)

const resolveSelectionFromGraph = ({
  selectedNode,
  focusedNode,
  selectedEdge,
  focusedEdge,
  getNode,
  getEdge
}: {
  selectedNode: string | null
  focusedNode: string | null
  selectedEdge: string | null
  focusedEdge: string | null
  getNode: (id: string) => RawNodeType | null
  getEdge: (id: string, dynamicId?: boolean) => RawEdgeType | null
}): ActionInspectorSelection | null => {
  if (focusedNode || selectedNode) {
    const node = getNode(focusedNode ?? selectedNode ?? '')
    if (node) {
      return { kind: 'node', node: node as ActionInspectorNode }
    }
  }

  if (focusedEdge || selectedEdge) {
    const edge = getEdge(focusedEdge ?? selectedEdge ?? '', true)
    if (edge) {
      return {
        kind: 'edge',
        edge: {
          ...(edge as ActionInspectorEdge),
          sourceNode: getNode(edge.source) ?? undefined,
          targetNode: getNode(edge.target) ?? undefined
        }
      }
    }
  }

  return null
}

const ActionInspector = ({ initialTab = 'inspect', selection }: ActionInspectorProps) => {
  const { t } = useTranslation()
  const selectedNode = useGraphStore.use.selectedNode()
  const focusedNode = useGraphStore.use.focusedNode()
  const selectedEdge = useGraphStore.use.selectedEdge()
  const focusedEdge = useGraphStore.use.focusedEdge()
  const graphDataVersion = useGraphStore.use.graphDataVersion()
  const rawGraph = useGraphStore.use.rawGraph()
  const mutationError = useGraphWorkbenchStore.use.mutationError()
  const conflictError = useGraphWorkbenchStore.use.conflictError()
  const activeTab = useGraphWorkbenchStore.use.activeActionMode()
  const setActiveActionMode = useGraphWorkbenchStore.use.setActiveActionMode()
  const clearMutationError = useGraphWorkbenchStore.use.clearMutationError()

  useEffect(() => {
    setActiveActionMode(initialTab)
  }, [initialTab, setActiveActionMode])

  const effectiveActiveTab = activeTab === 'inspect' ? initialTab : activeTab

  const getNode = useCallback((id: string) => rawGraph?.getNode(id) || null, [rawGraph])
  const getEdge = useCallback(
    (id: string, dynamicId: boolean = true) => rawGraph?.getEdge(id, dynamicId) || null,
    [rawGraph]
  )

  const currentSelection = useMemo(() => {
    if (selection !== undefined) {
      return selection
    }

    return resolveSelectionFromGraph({
      selectedNode,
      focusedNode,
      selectedEdge,
      focusedEdge,
      getNode,
      getEdge
    })
  }, [
    selection,
    selectedNode,
    focusedNode,
    selectedEdge,
    focusedEdge,
    graphDataVersion,
    rawGraph,
    getNode,
    getEdge
  ])

  const errorText = conflictError ?? mutationError
  const errorClassName = conflictError
    ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'

  return (
    <div className="bg-background/80 h-full rounded-xl border backdrop-blur-sm">
      <div className="flex h-full flex-col gap-3 p-3">
        <div>
          <h2 className="text-sm font-semibold">{t('graphPanel.workbench.actionInspector.title')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('graphPanel.workbench.actionInspector.description')}
          </p>
        </div>

        {errorText && (
          <div className={`rounded-md border px-3 py-2 text-xs ${errorClassName}`}>
            <div className="flex items-start justify-between gap-2">
              <p>{errorText}</p>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={clearMutationError}>
                {t('graphPanel.workbench.actionInspector.clearError')}
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {ACTION_INSPECTOR_TABS.map((tab) => (
            <Button
              key={tab}
              size="sm"
              variant={effectiveActiveTab === tab ? 'default' : 'outline'}
              className="text-xs"
              onClick={() => setActiveActionMode(tab)}
            >
              {t(`graphPanel.workbench.actionInspector.tabs.${tab}`)}
            </Button>
          ))}
        </div>

        {effectiveActiveTab !== 'inspect' ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-3">
            {effectiveActiveTab === 'create' && (
              <div className="space-y-3">
                <CreateNodeForm />
                <CreateRelationForm selection={currentSelection} />
              </div>
            )}
            {effectiveActiveTab === 'delete' && <DeleteGraphObjectPanel selection={currentSelection} />}
            {effectiveActiveTab === 'merge' && <MergeEntityPanel selection={currentSelection} />}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <PropertiesView panelClassName="bg-background/70 h-full overflow-y-auto rounded-lg border p-3 text-xs" />
          </div>
        )}
      </div>
    </div>
  )
}

export { ActionInspector }
export default ActionInspector
