import { useRegisterEvents, useSetSettings, useSigma } from '@react-sigma/core'
import { AbstractGraph } from 'graphology-types'
// import { useLayoutCircular } from '@react-sigma/layout-circular'
import { useLayoutForceAtlas2 } from '@react-sigma/layout-forceatlas2'
import { type MutableRefObject, useEffect, useRef, useState } from 'react'

// import useRandomGraph, { EdgeType, NodeType } from '@/hooks/useRandomGraph'
import { EdgeType, NodeType } from '@/hooks/useLightragGraph'
import useTheme from '@/hooks/useTheme'
import * as Constants from '@/lib/constants'

import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import {
  loadGraphCameraView,
  restorePersistedCameraView,
  saveGraphNodePosition,
  subscribeToCameraViewPersistence
} from '@/utils/graphViewPersistence'
import { applyLinkedDragMovement } from '@/utils/graphDrag'
import { getGraphInteractionSettings } from '@/utils/graphInteractionSettings'
import { getEdgeLabelFontSize } from '@/utils/graphLabelSize'

const isButtonPressed = (ev: MouseEvent | TouchEvent) => {
  if (ev.type.startsWith('mouse')) {
    if ((ev as MouseEvent).buttons !== 0) {
      return true
    }
  }
  return false
}

type NodeEvent = { node: string; event: { original: MouseEvent | TouchEvent } }
type EdgeEvent = { edge: string; event: { original: MouseEvent | TouchEvent } }

type GraphEventHandlerDeps = {
  sigma: ReturnType<typeof useSigma<NodeType, EdgeType>>
  enableEdgeEvents: boolean
  enableNodeDrag: boolean
  enableSearchLinkedDrag: boolean
  selectedNode: string | null
  selectedNodeSource: 'graph' | 'search' | null
  draggedNodeRef: MutableRefObject<string | null>
  linkedDraggedNodeIdsRef: MutableRefObject<string[]>
  wasDraggingRef: MutableRefObject<boolean>
}

export const buildGraphEventHandlers = ({
  sigma,
  enableEdgeEvents,
  enableNodeDrag,
  enableSearchLinkedDrag,
  selectedNode,
  selectedNodeSource,
  draggedNodeRef,
  linkedDraggedNodeIdsRef,
  wasDraggingRef
}: GraphEventHandlerDeps): Record<string, any> => {
  const { setFocusedNode, setSelectedNode, setFocusedEdge, setSelectedEdge, clearSelection } =
    useGraphStore.getState()

  const events: Record<string, any> = {
    enterNode: (event: NodeEvent) => {
      if (!isButtonPressed(event.event.original)) {
        const graph = sigma.getGraph()
        if (graph.hasNode(event.node)) {
          setFocusedNode(event.node)
        }
      }
    },
    leaveNode: (event: NodeEvent) => {
      if (!isButtonPressed(event.event.original)) {
        setFocusedNode(null)
      }
    },
    clickNode: (event: NodeEvent) => {
      if (wasDraggingRef.current) {
        wasDraggingRef.current = false
        return
      }
      const graph = sigma.getGraph()
      if (graph.hasNode(event.node)) {
        setSelectedNode(event.node)
        setSelectedEdge(null)
      }
    },
    clickStage: () => clearSelection()
  }

  if (enableEdgeEvents) {
    events.clickEdge = (event: EdgeEvent) => {
      setSelectedEdge(event.edge)
      setSelectedNode(null)
    }

    events.enterEdge = (event: EdgeEvent) => {
      if (!isButtonPressed(event.event.original)) {
        setFocusedEdge(event.edge)
      }
    }

    events.leaveEdge = (event: EdgeEvent) => {
      if (!isButtonPressed(event.event.original)) {
        setFocusedEdge(null)
      }
    }
  }

  if (!enableNodeDrag) {
    return events
  }

  events.downNode = (event: NodeEvent) => {
    const graph = sigma.getGraph()
    if (graph.hasNode(event.node)) {
      draggedNodeRef.current = event.node
      linkedDraggedNodeIdsRef.current =
        enableSearchLinkedDrag && selectedNodeSource === 'search' && selectedNode === event.node
          ? graph.neighbors(event.node).filter((nodeId) => graph.hasNode(nodeId))
          : []
      graph.setNodeAttribute(event.node, 'highlighted', true)
    }
  }

  events.mousemovebody = (event: any) => {
    if (!draggedNodeRef.current) return
    const pos = sigma.viewportToGraph(event)
    const graph = sigma.getGraph()
    if (!graph.hasNode(draggedNodeRef.current)) return
    const draggedNodeId = draggedNodeRef.current
    const movedPositions = applyLinkedDragMovement({
      positions: [draggedNodeId, ...linkedDraggedNodeIdsRef.current].reduce(
        (acc, nodeId) => {
          if (!graph.hasNode(nodeId)) {
            return acc
          }

          acc[nodeId] = {
            x: graph.getNodeAttribute(nodeId, 'x') as number,
            y: graph.getNodeAttribute(nodeId, 'y') as number
          }
          return acc
        },
        {} as Record<string, { x: number; y: number }>
      ),
      draggedNodeId,
      linkedNodeIds: linkedDraggedNodeIdsRef.current,
      nextPosition: { x: pos.x, y: pos.y }
    })

    for (const [nodeId, nodePosition] of Object.entries(movedPositions)) {
      if (!graph.hasNode(nodeId)) {
        continue
      }

      graph.setNodeAttribute(nodeId, 'x', nodePosition.x)
      graph.setNodeAttribute(nodeId, 'y', nodePosition.y)
    }
    wasDraggingRef.current = true
    event.preventSigmaDefault()
    event.original.preventDefault()
    event.original.stopPropagation()
  }

  events.mouseup = () => {
    if (draggedNodeRef.current) {
      const nodeId = draggedNodeRef.current
      const graph = sigma.getGraph()
      if (graph.hasNode(nodeId)) {
        graph.removeNodeAttribute(nodeId, 'highlighted')
        const state = useGraphStore.getState()
        const rg = state.rawGraph
        if (rg) {
          const draggedNodeIds = [nodeId, ...linkedDraggedNodeIdsRef.current]
          for (const draggedId of draggedNodeIds) {
            const idx = rg.nodeIdMap[draggedId]
            if (idx !== undefined && rg.nodes[idx]) {
              rg.nodes[idx].x = graph.getNodeAttribute(draggedId, 'x') as number
              rg.nodes[idx].y = graph.getNodeAttribute(draggedId, 'y') as number
            }
          }

          const settings = useSettingsStore.getState()
          for (const draggedId of draggedNodeIds) {
            saveGraphNodePosition(
              {
                workspace: settings.currentWorkspace,
                queryLabel: state.lastSuccessfulQueryLabel
              },
              draggedId,
              graph.getNodeAttribute(draggedId, 'x') as number,
              graph.getNodeAttribute(draggedId, 'y') as number
            )
          }
        }
      }
      draggedNodeRef.current = null
      linkedDraggedNodeIdsRef.current = []
    }
  }

  events.mousedown = () => {
    wasDraggingRef.current = false
    if (!sigma.getCustomBBox()) {
      sigma.setCustomBBox(sigma.getBBox())
    }
  }

  return events
}

const GraphControl = ({ disableHoverEffect }: { disableHoverEffect?: boolean }) => {
  const sigma = useSigma<NodeType, EdgeType>()
  const registerEvents = useRegisterEvents<NodeType, EdgeType>()
  const setSettings = useSetSettings<NodeType, EdgeType>()

  const maxIterations = useSettingsStore.use.graphLayoutMaxIterations()
  const { assign: assignLayout } = useLayoutForceAtlas2({
    iterations: maxIterations
  })

  const { theme } = useTheme()
  const hideUnselectedEdges = useSettingsStore.use.enableHideUnselectedEdges()
  const enableEdgeEvents = useSettingsStore.use.enableEdgeEvents()
  const renderEdgeLabels = useSettingsStore.use.showEdgeLabel()
  const renderLabels = useSettingsStore.use.showNodeLabel()
  const graphLabelFontSize = useSettingsStore.use.graphLabelFontSize()
  const enableNodeDrag = useSettingsStore.use.enableNodeDrag()
  const enableSearchLinkedDrag = useSettingsStore.use.enableSearchLinkedDrag()
  const currentWorkspace = useSettingsStore.use.currentWorkspace()
  const minEdgeSize = useSettingsStore.use.minEdgeSize()
  const maxEdgeSize = useSettingsStore.use.maxEdgeSize()
  const selectedNode = useGraphStore.use.selectedNode()
  const selectedNodeSource = useGraphStore.use.selectedNodeSource()
  const focusedNode = useGraphStore.use.focusedNode()
  const selectedEdge = useGraphStore.use.selectedEdge()
  const focusedEdge = useGraphStore.use.focusedEdge()
  const sigmaGraph = useGraphStore.use.sigmaGraph()
  const lastSuccessfulQueryLabel = useGraphStore.use.lastSuccessfulQueryLabel()

  const draggedNodeRef = useRef<string | null>(null)
  const linkedDraggedNodeIdsRef = useRef<string[]>([])
  const wasDraggingRef = useRef(false)

  // Track system theme changes when theme is set to 'system'
  const [systemThemeIsDark, setSystemThemeIsDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => setSystemThemeIsDark(e.matches)
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    }
  }, [theme])

  // systemThemeIsDark triggers re-render on OS theme change, making isDarkTheme reactive
  const isDarkTheme = theme === 'dark' ||
    (theme === 'system' && systemThemeIsDark)

  /**
   * When component mount or maxIterations changes
   * => ensure graph reference and apply layout
   */
  useEffect(() => {
    if (sigmaGraph && sigma) {
      try {
        if (typeof sigma.setGraph === 'function') {
          sigma.setGraph(sigmaGraph as unknown as AbstractGraph<NodeType, EdgeType>);
        } else {
          console.error('Sigma instance missing setGraph method — graph binding skipped');
          return;
        }
      } catch (error) {
        console.error('Error setting graph on sigma instance:', error);
        return;
      }

      assignLayout();
    }
  }, [sigma, sigmaGraph, assignLayout, maxIterations])

  useEffect(() => {
    if (!sigma || !sigmaGraph) {
      return
    }

    const persistedCameraView = loadGraphCameraView({
      workspace: currentWorkspace,
      queryLabel: lastSuccessfulQueryLabel
    })
    if (!persistedCameraView) {
      return
    }

    restorePersistedCameraView(sigma.getCamera(), persistedCameraView)
  }, [sigma, sigmaGraph, currentWorkspace, lastSuccessfulQueryLabel])

  useEffect(() => {
    if (!sigma || !sigmaGraph || !lastSuccessfulQueryLabel) {
      return
    }

    return subscribeToCameraViewPersistence(sigma.getCamera(), {
      workspace: currentWorkspace,
      queryLabel: lastSuccessfulQueryLabel
    })
  }, [sigma, sigmaGraph, currentWorkspace, lastSuccessfulQueryLabel])

  /**
   * Ensure the sigma instance is set in the store
   * This provides a backup in case the instance wasn't set in GraphViewer
   */
  useEffect(() => {
    if (sigma) {
      // Double-check that the store has the sigma instance
      const currentInstance = useGraphStore.getState().sigmaInstance;
      if (!currentInstance) {
        useGraphStore.getState().setSigmaInstance(sigma);
      }
    }
  }, [sigma]);

  /**
   * When component mount
   * => register events
   */
  useEffect(() => {
    registerEvents(
      buildGraphEventHandlers({
        sigma,
        enableEdgeEvents,
        enableNodeDrag,
        enableSearchLinkedDrag,
        selectedNode,
        selectedNodeSource,
        draggedNodeRef,
        linkedDraggedNodeIdsRef,
        wasDraggingRef
      })
    )

    return () => {
      draggedNodeRef.current = null
      linkedDraggedNodeIdsRef.current = []
      wasDraggingRef.current = false
    }
  }, [
    registerEvents,
    sigma,
    enableEdgeEvents,
    enableNodeDrag,
    enableSearchLinkedDrag,
    selectedNode,
    selectedNodeSource
  ])

  /**
   * When edge size settings change, recalculate edge sizes and refresh the sigma instance
   * to ensure changes take effect immediately
   */
  useEffect(() => {
    if (sigma && sigmaGraph) {
      // Get the graph from sigma
      const graph = sigma.getGraph()

      // Find min and max weight values
      let minWeight = Number.MAX_SAFE_INTEGER
      let maxWeight = 0

      graph.forEachEdge(edge => {
        // Get original weight (before scaling)
        const weight = graph.getEdgeAttribute(edge, 'originalWeight') || 1
        if (typeof weight === 'number') {
          minWeight = Math.min(minWeight, weight)
          maxWeight = Math.max(maxWeight, weight)
        }
      })

      // Scale edge sizes based on weight range and current min/max edge size settings
      const weightRange = maxWeight - minWeight
      if (weightRange > 0) {
        const sizeScale = maxEdgeSize - minEdgeSize
        graph.forEachEdge(edge => {
          const weight = graph.getEdgeAttribute(edge, 'originalWeight') || 1
          if (typeof weight === 'number') {
            const scaledSize = minEdgeSize + sizeScale * Math.pow((weight - minWeight) / weightRange, 0.5)
            graph.setEdgeAttribute(edge, 'size', scaledSize)
          }
        })
      } else {
        // If all weights are the same, use default size
        graph.forEachEdge(edge => {
          graph.setEdgeAttribute(edge, 'size', minEdgeSize)
        })
      }

      // Refresh the sigma instance to apply changes
      sigma.refresh()
    }
  }, [sigma, sigmaGraph, minEdgeSize, maxEdgeSize])


  /**
   * Simple display settings — rarely change, separate from reducers
   */
  useEffect(() => {
    setSettings({
      ...getGraphInteractionSettings(enableEdgeEvents),
      edgeLabelSize: getEdgeLabelFontSize(graphLabelFontSize),
      labelSize: graphLabelFontSize,
      renderEdgeLabels,
      renderLabels
    })
  }, [setSettings, enableEdgeEvents, graphLabelFontSize, renderEdgeLabels, renderLabels])

  /**
   * Reducers for node/edge appearance — depend on interaction state
   */
  useEffect(() => {
    const labelColor = isDarkTheme ? Constants.labelColorDarkTheme : undefined
    const edgeColor = isDarkTheme ? Constants.edgeColorDarkTheme : undefined
    const edgeHighlightColor = isDarkTheme
      ? Constants.edgeColorHighlightedDarkTheme
      : Constants.edgeColorHighlightedLightTheme

    setSettings({
      nodeReducer: (node, data) => {
        const graph = sigma.getGraph()

        if (!graph.hasNode(node)) {
          return { ...data, highlighted: false, labelColor }
        }

        const newData: NodeType & {
          labelColor?: string
          borderColor?: string
        } = { ...data, highlighted: data.highlighted || false, labelColor }

        if (!disableHoverEffect) {
          newData.highlighted = false
          const _focusedNode = focusedNode || selectedNode
          const _focusedEdge = focusedEdge || selectedEdge

          if (_focusedNode && graph.hasNode(_focusedNode)) {
            try {
              if (node === _focusedNode || graph.neighbors(_focusedNode).includes(node)) {
                newData.highlighted = true
                if (node === selectedNode) {
                  newData.borderColor = Constants.nodeBorderColorSelected
                }
              }
            } catch {
              return { ...data, highlighted: false, labelColor }
            }
          } else if (_focusedEdge && graph.hasEdge(_focusedEdge)) {
            try {
              if (graph.extremities(_focusedEdge).includes(node)) {
                newData.highlighted = true
                newData.size = 3
              }
            } catch {
              return { ...data, highlighted: false, labelColor }
            }
          } else {
            return newData
          }

          if (newData.highlighted) {
            if (isDarkTheme) {
              newData.labelColor = Constants.LabelColorHighlightedDarkTheme
            }
          } else {
            newData.color = Constants.nodeColorDisabled
          }
        }
        return newData
      },

      edgeReducer: (edge, data) => {
        const graph = sigma.getGraph()

        if (!graph.hasEdge(edge)) {
          return { ...data, hidden: false, labelColor, color: edgeColor }
        }

        const newData = { ...data, hidden: false, labelColor, color: edgeColor }

        if (!disableHoverEffect) {
          const _focusedNode = focusedNode || selectedNode

          if (_focusedNode && graph.hasNode(_focusedNode)) {
            try {
              if (hideUnselectedEdges) {
                if (!graph.extremities(edge).includes(_focusedNode)) {
                  newData.hidden = true
                }
              } else {
                if (graph.extremities(edge).includes(_focusedNode)) {
                  newData.color = edgeHighlightColor
                }
              }
            } catch {
              return { ...data, hidden: false, labelColor, color: edgeColor }
            }
          } else {
            const _selectedEdge = selectedEdge && graph.hasEdge(selectedEdge) ? selectedEdge : null
            const _focusedEdge = focusedEdge && graph.hasEdge(focusedEdge) ? focusedEdge : null

            if (_selectedEdge || _focusedEdge) {
              if (edge === _selectedEdge) {
                newData.color = Constants.edgeColorSelected
              } else if (edge === _focusedEdge) {
                newData.color = edgeHighlightColor
              } else if (hideUnselectedEdges) {
                newData.hidden = true
              }
            }
          }
        }
        return newData
      }
    })
  }, [
    selectedNode,
    focusedNode,
    selectedEdge,
    focusedEdge,
    setSettings,
    sigma,
    disableHoverEffect,
    isDarkTheme,
    hideUnselectedEdges
  ])

  return null
}

export default GraphControl
