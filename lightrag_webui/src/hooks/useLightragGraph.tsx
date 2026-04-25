import Graph, { UndirectedGraph } from 'graphology'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/lib/utils'
import * as Constants from '@/lib/constants'
import {
  useGraphStore,
  RawGraph,
  RawNodeType,
  RawEdgeType,
  type GraphViewState
} from '@/stores/graph'
import { useGraphWorkbenchStore } from '@/stores/graphWorkbench'
import { toast } from 'sonner'
import { queryGraphs, queryGraphWorkbench } from '@/api/lightrag'
import { useBackendState } from '@/stores/state'
import { useSettingsStore } from '@/stores/settings'
import useGraphLayoutWorker from '@/hooks/useGraphLayoutWorker'
import { createGraphRequestState, isAbortError } from '@/utils/graphRequestState'

import seedrandom from 'seedrandom'
import { resolveNodeColor, DEFAULT_NODE_COLOR } from '@/utils/graphColor'
import { resolveNodeDisplayName } from '@/utils/graphLabel'

// Select color based on node type
const getNodeColorByType = (nodeType: string | undefined): string => {
  const state = useGraphStore.getState()
  const { color, map, updated } = resolveNodeColor(nodeType, state.typeColorMap)

  if (updated) {
    useGraphStore.setState({ typeColorMap: map })
  }

  return color || DEFAULT_NODE_COLOR
};


const validateGraph = (graph: RawGraph) => {
  // Check if graph exists
  if (!graph) {
    console.log('Graph validation failed: graph is null');
    return false;
  }

  // Check if nodes and edges are arrays
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    console.log('Graph validation failed: nodes or edges is not an array');
    return false;
  }

  // Check if nodes array is empty
  if (graph.nodes.length === 0) {
    console.log('Graph validation failed: nodes array is empty');
    return false;
  }

  // Validate each node
  for (const node of graph.nodes) {
    if (!node.id || !node.labels || !node.properties) {
      console.log('Graph validation failed: invalid node structure');
      return false;
    }
  }

  // Validate each edge
  for (const edge of graph.edges) {
    if (!edge.id || !edge.source || !edge.target) {
      console.log('Graph validation failed: invalid edge structure');
      return false;
    }
  }

  // Validate edge connections
  for (const edge of graph.edges) {
    const source = graph.getNode(edge.source);
    const target = graph.getNode(edge.target);
    if (source == undefined || target == undefined) {
      console.log('Graph validation failed: edge references non-existent node');
      return false;
    }
  }

  console.log('Graph validation passed');
  return true;
}

export type NodeType = {
  x: number
  y: number
  label: string
  size: number
  color: string
  highlighted?: boolean
}
export type EdgeType = {
  label: string
  originalWeight?: number
  size?: number
  color?: string
  hidden?: boolean
}

const isAuthRequiredMessage = (message: string | null | undefined): boolean =>
  !!message && message.toLowerCase().includes('authentication required')

export const resolveGraphErrorViewState = (error: unknown): GraphViewState => {
  const message = errorMessage(error)
  return isAuthRequiredMessage(message) ? 'auth_error' : 'error'
}

const fetchGraph = async (
  label: string,
  maxDepth: number,
  maxNodes: number,
  signal?: AbortSignal,
  appliedStructuredQuery?: Parameters<typeof queryGraphWorkbench>[0] | null
) => {
  let rawData: any = null;
  let isTruncated = false;

  // Trigger GraphLabels component to check if the label is valid
  // console.log('Setting labelsFetchAttempted to true');
  useGraphStore.getState().setLabelsFetchAttempted(true)

  // If label is empty, use default label '*'
  const queryLabel = label || '*';

  try {
    if (appliedStructuredQuery) {
      console.log('Fetching graph with structured query payload')
      const structuredResponse = await queryGraphWorkbench(appliedStructuredQuery, signal)
      rawData = structuredResponse.data
      isTruncated =
        !!structuredResponse.data?.is_truncated ||
        structuredResponse.truncation.was_truncated_before_filtering ||
        structuredResponse.truncation.was_truncated_after_filtering
    } else {
      console.log(`Fetching graph label: ${queryLabel}, depth: ${maxDepth}, nodes: ${maxNodes}`);
      rawData = await queryGraphs(queryLabel, maxDepth, maxNodes, signal);
      isTruncated = !!rawData?.is_truncated
    }
  } catch (e) {
    throw e
  }

  let rawGraph = null;

  if (rawData) {
    const nodeIdMap: Record<string, number> = {}
    const edgeIdMap: Record<string, number> = {}

    for (let i = 0; i < rawData.nodes.length; i++) {
      const node = rawData.nodes[i]
      nodeIdMap[node.id] = i

      node.x = Math.random()
      node.y = Math.random()
      node.degree = 0
      node.size = 10
    }

    for (let i = 0; i < rawData.edges.length; i++) {
      const edge = rawData.edges[i]
      edgeIdMap[edge.id] = i

      const source = nodeIdMap[edge.source]
      const target = nodeIdMap[edge.target]
      if (source !== undefined && target !== undefined) {
        const sourceNode = rawData.nodes[source]
        if (!sourceNode) {
          console.error(`Source node ${edge.source} is undefined`)
          continue
        }

        const targetNode = rawData.nodes[target]
        if (!targetNode) {
          console.error(`Target node ${edge.target} is undefined`)
          continue
        }
        sourceNode.degree += 1
        targetNode.degree += 1
      }
    }

    // generate node size
    let minDegree = Number.MAX_SAFE_INTEGER
    let maxDegree = 0

    for (const node of rawData.nodes) {
      minDegree = Math.min(minDegree, node.degree)
      maxDegree = Math.max(maxDegree, node.degree)
    }
    const range = maxDegree - minDegree
    if (range > 0) {
      const scale = Constants.maxNodeSize - Constants.minNodeSize
      for (const node of rawData.nodes) {
        node.size = Math.round(
          Constants.minNodeSize + scale * Math.pow((node.degree - minDegree) / range, 0.5)
        )
      }
    }

    rawGraph = new RawGraph()
    rawGraph.nodes = rawData.nodes
    rawGraph.edges = rawData.edges
    rawGraph.nodeIdMap = nodeIdMap
    rawGraph.edgeIdMap = edgeIdMap

    if (!validateGraph(rawGraph)) {
      rawGraph = null
      console.warn('Invalid graph data')
    }
    console.log('Graph data loaded')
  }

  // console.debug({ data: JSON.parse(JSON.stringify(rawData)) })
  return { rawGraph, is_truncated: isTruncated }
}

// Create a new graph instance with the raw graph data
const createSigmaGraph = (rawGraph: RawGraph | null) => {
  // Get edge size settings from store
  const minEdgeSize = useSettingsStore.getState().minEdgeSize
  const maxEdgeSize = useSettingsStore.getState().maxEdgeSize
  // Skip graph creation if no data or empty nodes
  if (!rawGraph || !rawGraph.nodes.length) {
    console.log('No graph data available, skipping sigma graph creation');
    return null;
  }

  // Create new graph instance
  const graph = new UndirectedGraph()

  // Add nodes from raw graph data
  for (const rawNode of rawGraph?.nodes ?? []) {
    // Use local PRNG to avoid polluting global Math.random
    const rng = seedrandom(rawNode.id + Date.now().toString())
    const x = rng()
    const y = rng()

    graph.addNode(rawNode.id, {
      label: resolveNodeDisplayName(rawNode),
      color: rawNode.color,
      x: x,
      y: y,
      size: rawNode.size,
      // for node-border
      borderColor: Constants.nodeBorderColor,
      borderSize: 0.2
    })
  }

  // Add edges from raw graph data
  for (const rawEdge of rawGraph?.edges ?? []) {
    // Get weight from edge properties or default to 1
    const weight = rawEdge.properties?.weight !== undefined ? Number(rawEdge.properties.weight) : 1

    rawEdge.dynamicId = graph.addEdge(rawEdge.source, rawEdge.target, {
      label: rawEdge.properties?.keywords || undefined,
      size: weight, // Set initial size based on weight
      originalWeight: weight, // Store original weight for recalculation
      type: 'curvedNoArrow' // Explicitly set edge type to no arrow
    })
  }

  // Calculate edge size based on weight range, similar to node size calculation
  let minWeight = Number.MAX_SAFE_INTEGER
  let maxWeight = 0

  // Find min and max weight values
  graph.forEachEdge(edge => {
    const weight = graph.getEdgeAttribute(edge, 'originalWeight') || 1
    minWeight = Math.min(minWeight, weight)
    maxWeight = Math.max(maxWeight, weight)
  })

  // Scale edge sizes based on weight range
  const weightRange = maxWeight - minWeight
  if (weightRange > 0) {
    const sizeScale = maxEdgeSize - minEdgeSize
    graph.forEachEdge(edge => {
      const weight = graph.getEdgeAttribute(edge, 'originalWeight') || 1
      const scaledSize = minEdgeSize + sizeScale * Math.pow((weight - minWeight) / weightRange, 0.5)
      graph.setEdgeAttribute(edge, 'size', scaledSize)
    })
  } else {
    // If all weights are the same, use default size
    graph.forEachEdge(edge => {
      graph.setEdgeAttribute(edge, 'size', minEdgeSize)
    })
  }

  return graph
}

const updateAllEdgeSizes = (sigmaGraph: UndirectedGraph) => {
  const minEdgeSize = useSettingsStore.getState().minEdgeSize
  const maxEdgeSize = useSettingsStore.getState().maxEdgeSize
  let minWeight = Number.MAX_SAFE_INTEGER
  let maxWeight = 0

  sigmaGraph.forEachEdge((edge) => {
    const weight = sigmaGraph.getEdgeAttribute(edge, 'originalWeight') || 1
    minWeight = Math.min(minWeight, weight)
    maxWeight = Math.max(maxWeight, weight)
  })

  const weightRange = maxWeight - minWeight || 1
  const sizeScale = maxEdgeSize - minEdgeSize

  sigmaGraph.forEachEdge((edge) => {
    const weight = sigmaGraph.getEdgeAttribute(edge, 'originalWeight') || 1
    const scaledSize = minEdgeSize + sizeScale * Math.pow((weight - minWeight) / weightRange, 0.5)
    sigmaGraph.setEdgeAttribute(edge, 'size', scaledSize)
  })
}

const useLightrangeGraph = () => {
  const { t } = useTranslation()
  const { runLayout } = useGraphLayoutWorker()
  const queryLabel = useSettingsStore.use.queryLabel()
  const appliedWorkbenchQuery = useGraphWorkbenchStore.use.appliedQuery()
  const workbenchQueryVersion = useGraphWorkbenchStore.use.queryVersion()
  const rawGraph = useGraphStore.use.rawGraph()
  const sigmaGraph = useGraphStore.use.sigmaGraph()
  const maxQueryDepth = useSettingsStore.use.graphQueryMaxDepth()
  const maxNodes = useSettingsStore.use.graphMaxNodes()
  const nodeToExpand = useGraphStore.use.nodeToExpand()
  const nodeToPrune = useGraphStore.use.nodeToPrune()
  const graphDataVersion = useGraphStore.use.graphDataVersion()


  // Use ref to track if data has been loaded and initial load
  const dataLoadedRef = useRef(false)
  const initialLoadRef = useRef(false)
  // Use ref to track if empty data has been handled
  const emptyDataHandledRef = useRef(false)
  const requestStateRef = useRef(createGraphRequestState())

  const getNode = useCallback(
    (nodeId: string) => {
      return rawGraph?.getNode(nodeId) || null
    },
    [rawGraph]
  )

  const getEdge = useCallback(
    (edgeId: string, dynamicId: boolean = true) => {
      return rawGraph?.getEdge(edgeId, dynamicId) || null
    },
    [rawGraph]
  )

  useEffect(() => {
    const state = useGraphStore.getState()
    requestStateRef.current.abortCurrent()
    state.setGraphDataFetchAttempted(false)
    emptyDataHandledRef.current = false
  }, [appliedWorkbenchQuery, workbenchQueryVersion, queryLabel, maxQueryDepth, maxNodes])

  useEffect(() => {
    return () => {
      requestStateRef.current.reset()
    }
  }, [])

  // Graph data fetching logic
  useEffect(() => {
    // Empty queryLabel should be only handle once(avoid infinite loop)
    if (!appliedWorkbenchQuery && !queryLabel && emptyDataHandledRef.current) {
      return
    }

    // Only fetch data when graphDataFetchAttempted is false (avoids re-fetching on vite dev mode)
    // GraphDataFetchAttempted must set to false when queryLabel is changed
    const state = useGraphStore.getState()
    if (state.graphDataFetchAttempted) {
      return
    }

    const { requestId, signal } = requestStateRef.current.start()
    state.setGraphDataFetchAttempted(true)
    state.setIsFetching(true)
    state.setViewState('loading')
    state.setRequestError(null)
    state.clearSelection()
    if (state.sigmaGraph) {
      state.sigmaGraph.forEachNode((node) => {
        state.sigmaGraph?.setNodeAttribute(node, 'highlighted', false)
      })
    }

    console.log('Preparing graph data...')

    const currentQueryLabel = appliedWorkbenchQuery?.scope.label ?? queryLabel
    const currentMaxQueryDepth = appliedWorkbenchQuery?.scope.max_depth ?? maxQueryDepth
    const currentMaxNodes = appliedWorkbenchQuery?.scope.max_nodes ?? maxNodes
    const useStructuredQuery = !!appliedWorkbenchQuery

    const loadGraph = async () => {
      try {
        const result =
          useStructuredQuery
            ? await fetchGraph(
                currentQueryLabel || '*',
                currentMaxQueryDepth,
                currentMaxNodes,
                signal,
                appliedWorkbenchQuery
              )
            : currentQueryLabel
              ? await fetchGraph(currentQueryLabel, currentMaxQueryDepth, currentMaxNodes, signal)
              : { rawGraph: null, is_truncated: false }

        if (!requestStateRef.current.isCurrent(requestId)) {
          return
        }

        const nextState = useGraphStore.getState()
        const data = result?.rawGraph

        nextState.reset()
        nextState.setGraphDataFetchAttempted(true)
        nextState.setIsFetching(false)
        nextState.setRequestError(null)

        if (data?.nodes) {
          data.nodes.forEach((node) => {
            const nodeEntityType = node.properties?.entity_type as string | undefined
            node.color = getNodeColorByType(nodeEntityType)
          })
        }

        if (result?.is_truncated) {
          toast.info(t('graphPanel.dataIsTruncated', 'Graph data is truncated to Max Nodes'))
        }

        if (!data || !data.nodes || data.nodes.length === 0) {
          nextState.setSigmaGraph(null)
          nextState.setRawGraph(null)
          nextState.setGraphIsEmpty(true)
          nextState.setViewState('empty')
          nextState.setLastSuccessfulQueryLabel('')
        } else {
          const newSigmaGraph = createSigmaGraph(data)
          data.buildDynamicMap()
          nextState.setSigmaGraph(newSigmaGraph)
          nextState.setRawGraph(data)
          nextState.setGraphIsEmpty(false)
          nextState.setViewState('ready')
          nextState.setLastSuccessfulQueryLabel(currentQueryLabel)
          nextState.setMoveToSelectedNode(true)
        }

        dataLoadedRef.current = true
        initialLoadRef.current = true
        if ((!data || !data.nodes || data.nodes.length === 0) && !currentQueryLabel) {
          emptyDataHandledRef.current = true
        }
      } catch (error) {
        if (isAbortError(error) || !requestStateRef.current.isCurrent(requestId)) {
          return
        }

        console.error('Error fetching graph data:', error)
        const nextState = useGraphStore.getState()
        const message = errorMessage(error)
        const viewState = resolveGraphErrorViewState(error)

        useBackendState.getState().setErrorMessage(message, 'Query Graphs Error!')
        nextState.setIsFetching(false)
        nextState.setGraphDataFetchAttempted(false)
        nextState.setSigmaGraph(null)
        nextState.setRawGraph(null)
        nextState.setGraphIsEmpty(viewState === 'auth_error')
        nextState.setViewState(viewState)
        nextState.setRequestError(message)
        nextState.setLastSuccessfulQueryLabel('')
        dataLoadedRef.current = false
      }
    }

    void loadGraph()

    return () => {
      if (requestStateRef.current.isCurrent(requestId)) {
        requestStateRef.current.abortCurrent()
      }
    }
  }, [
    queryLabel,
    appliedWorkbenchQuery,
    workbenchQueryVersion,
    maxQueryDepth,
    maxNodes,
    t,
    graphDataVersion
  ])

  // Handle node expansion
  useEffect(() => {
    const nodeId = useGraphStore.getState().nodeToExpand
    if (!nodeId) return

    const handleNodeExpand = async () => {
      const state = useGraphStore.getState()
      const { sigmaGraph: currentSigmaGraph, rawGraph: currentRawGraph } = state
      if (!currentSigmaGraph || !currentRawGraph) return

      try {
        state.setIsFetching(true)
        state.setViewState('loading')

        const nodeToExpand = currentRawGraph.getNode(nodeId)
        if (!nodeToExpand) {
          console.error('Node not found:', nodeId)
          return
        }

        const label = nodeToExpand.labels[0]
        if (!label) {
          console.error('Node has no label:', nodeId)
          return
        }

        const extendedGraph = await queryGraphs(label, 2, 1000)
        if (!extendedGraph || !extendedGraph.nodes || !extendedGraph.edges) {
          console.error('Failed to fetch extended graph')
          return
        }

        const processedNodes: RawNodeType[] = extendedGraph.nodes.map((node) => {
          const rng = seedrandom(node.id)
          const nodeEntityType = node.properties?.entity_type as string | undefined
          return {
            id: node.id,
            labels: node.labels,
            properties: node.properties,
            size: 10,
            x: rng(),
            y: rng(),
            color: getNodeColorByType(nodeEntityType),
            degree: 0
          }
        })

        const processedEdges: RawEdgeType[] = extendedGraph.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          properties: edge.properties,
          dynamicId: ''
        }))

        const layoutResult = await runLayout({
          expandedNodeId: nodeId,
          expandedNodeSize: nodeToExpand.size,
          cameraRatio: state.sigmaInstance?.getCamera().ratio || 1,
          existingNodes: currentRawGraph.nodes.map((node) => ({
            id: node.id,
            x: currentSigmaGraph.getNodeAttribute(node.id, 'x'),
            y: currentSigmaGraph.getNodeAttribute(node.id, 'y'),
            degree: currentSigmaGraph.degree(node.id)
          })),
          existingEdges: currentRawGraph.edges.map((edge) => ({
            source: edge.source,
            target: edge.target
          })),
          incomingNodes: processedNodes,
          incomingEdges: processedEdges
        })

        layoutResult.nodeSizeUpdates.forEach((update) => {
          if (currentSigmaGraph.hasNode(update.id)) {
            currentSigmaGraph.setNodeAttribute(update.id, 'size', update.size)
          }
          const targetNode = currentRawGraph.getNode(update.id)
          if (targetNode) {
            targetNode.size = update.size
            targetNode.degree = update.degree
          }
        })

        if (layoutResult.noNewNodes) {
          toast.info(t('graphPanel.propertiesView.node.noNewNodes'))
          return
        }

        layoutResult.nodesToAdd.forEach((newNode) => {
          if (!currentSigmaGraph.hasNode(newNode.id)) {
            currentSigmaGraph.addNode(newNode.id, {
              label: resolveNodeDisplayName(newNode),
              color: newNode.color,
              x: newNode.x,
              y: newNode.y,
              size: newNode.size,
              borderColor: Constants.nodeBorderColor,
              borderSize: 0.2
            })
          }

          if (!currentRawGraph.getNode(newNode.id)) {
            currentRawGraph.nodes.push(newNode)
            currentRawGraph.nodeIdMap[newNode.id] = currentRawGraph.nodes.length - 1
          }
        })

        layoutResult.edgesToAdd.forEach((newEdge) => {
          if (currentSigmaGraph.hasEdge(newEdge.source, newEdge.target)) {
            return
          }

          const weight =
            newEdge.properties?.weight !== undefined ? Number(newEdge.properties.weight) : 1

          newEdge.dynamicId = currentSigmaGraph.addEdge(newEdge.source, newEdge.target, {
            label: newEdge.properties?.keywords || undefined,
            size: weight,
            originalWeight: weight,
            type: 'curvedNoArrow'
          })

          if (!currentRawGraph.getEdge(newEdge.id, false)) {
            currentRawGraph.edges.push(newEdge)
            currentRawGraph.edgeIdMap[newEdge.id] = currentRawGraph.edges.length - 1
            currentRawGraph.edgeDynamicIdMap[newEdge.dynamicId] = currentRawGraph.edges.length - 1
          }
        })

        currentRawGraph.buildDynamicMap()
        useGraphStore.getState().resetSearchEngine()
        updateAllEdgeSizes(currentSigmaGraph)

        if (layoutResult.expandedNodeUpdate && currentSigmaGraph.hasNode(nodeId)) {
          currentSigmaGraph.setNodeAttribute(nodeId, 'size', layoutResult.expandedNodeUpdate.size)
          nodeToExpand.size = layoutResult.expandedNodeUpdate.size
          nodeToExpand.degree = layoutResult.expandedNodeUpdate.degree
        }

        state.setViewState('ready')
      } catch (error) {
        console.error('Error expanding node:', error)
        state.setRequestError(errorMessage(error))
        state.setViewState(resolveGraphErrorViewState(error))
      } finally {
        state.setIsFetching(false)
      }
    }

    void handleNodeExpand()
    // Reset the nodeToExpand state after handling
    window.setTimeout(() => {
      useGraphStore.getState().triggerNodeExpand(null)
    }, 0)
  }, [nodeToExpand, sigmaGraph, rawGraph, runLayout, t])

  // Helper function to get all nodes that will be deleted
  const getNodesThatWillBeDeleted = useCallback((nodeId: string, graph: UndirectedGraph) => {
    const nodesToDelete = new Set<string>([nodeId]);

    // Find all nodes that would become isolated after deletion
    graph.forEachNode((node) => {
      if (node === nodeId) return; // Skip the node being deleted

      // Get all neighbors of this node
      const neighbors = graph.neighbors(node);

      // If this node has only one neighbor and that neighbor is the node being deleted,
      // this node will become isolated, so we should delete it too
      if (neighbors.length === 1 && neighbors[0] === nodeId) {
        nodesToDelete.add(node);
      }
    });

    return nodesToDelete;
  }, []);

  // Handle node pruning
  useEffect(() => {
    const nodeId = useGraphStore.getState().nodeToPrune;
    if (!nodeId) return;

    const handleNodePrune = () => {
      const state = useGraphStore.getState();
      const { sigmaGraph, rawGraph } = state;
      if (!sigmaGraph || !rawGraph) return;

      try {

        // 1. Check if node exists
        if (!sigmaGraph.hasNode(nodeId)) {
          console.error('Node not found:', nodeId);
          return;
        }

        // 2. Get nodes to delete
        const nodesToDelete = getNodesThatWillBeDeleted(nodeId, sigmaGraph);

        // 3. Check if this would delete all nodes
        if (nodesToDelete.size === sigmaGraph.nodes().length) {
          toast.error(t('graphPanel.propertiesView.node.deleteAllNodesError'));
          return;
        }

        // 4. Clear selection - this will cause PropertiesView to close immediately
        state.clearSelection();

        // 5. Delete nodes and related edges
        for (const nodeToDelete of nodesToDelete) {
          // Remove the node from the sigma graph (this will also remove connected edges)
          sigmaGraph.dropNode(nodeToDelete);

          // Remove the node from the raw graph
          const nodeIndex = rawGraph.nodeIdMap[nodeToDelete];
          if (nodeIndex !== undefined) {
            // Find all edges connected to this node
            const edgesToRemove = rawGraph.edges.filter(
              edge => edge.source === nodeToDelete || edge.target === nodeToDelete
            );

            // Remove edges from raw graph
            for (const edge of edgesToRemove) {
              const edgeIndex = rawGraph.edgeIdMap[edge.id];
              if (edgeIndex !== undefined) {
                // Remove from edges array
                rawGraph.edges.splice(edgeIndex, 1);
                // Update edgeIdMap for all edges after this one
                for (const [id, idx] of Object.entries(rawGraph.edgeIdMap)) {
                  if (idx > edgeIndex) {
                    rawGraph.edgeIdMap[id] = idx - 1;
                  }
                }
                // Remove from edgeIdMap
                delete rawGraph.edgeIdMap[edge.id];
                // Remove from edgeDynamicIdMap
                delete rawGraph.edgeDynamicIdMap[edge.dynamicId];
              }
            }

            // Remove node from nodes array
            rawGraph.nodes.splice(nodeIndex, 1);

            // Update nodeIdMap for all nodes after this one
            for (const [id, idx] of Object.entries(rawGraph.nodeIdMap)) {
              if (idx > nodeIndex) {
                rawGraph.nodeIdMap[id] = idx - 1;
              }
            }

            // Remove from nodeIdMap
            delete rawGraph.nodeIdMap[nodeToDelete];
          }
        }

        // Rebuild the dynamic edge map and invalidate search cache
        rawGraph.buildDynamicMap();

        // Reset search engine to force rebuild
        useGraphStore.getState().resetSearchEngine();

        // Show notification if we deleted more than just the selected node
        if (nodesToDelete.size > 1) {
          toast.info(t('graphPanel.propertiesView.node.nodesRemoved', { count: nodesToDelete.size }));
        }


      } catch (error) {
        console.error('Error pruning node:', error);
      }
    };

    handleNodePrune();
    // Reset the nodeToPrune state after handling
    window.setTimeout(() => {
      useGraphStore.getState().triggerNodePrune(null);
    }, 0);
  }, [nodeToPrune, sigmaGraph, rawGraph, getNodesThatWillBeDeleted, t]);

  const lightrageGraph = useCallback(() => {
    // If we already have a graph instance, return it
    if (sigmaGraph) {
      return sigmaGraph as Graph<NodeType, EdgeType>
    }

    // If no graph exists yet, create a new one and store it
    console.log('Creating new Sigma graph instance')
    const graph = new UndirectedGraph()
    useGraphStore.getState().setSigmaGraph(graph)
    return graph as Graph<NodeType, EdgeType>
  }, [sigmaGraph])

  return { lightrageGraph, getNode, getEdge }
}

export default useLightrangeGraph
