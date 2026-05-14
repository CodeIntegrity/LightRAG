import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
// import { MiniMap } from '@react-sigma/minimap'
import { SigmaContainer } from '@react-sigma/core'
import { Settings as SigmaSettings } from 'sigma/settings'
import { GraphSearchOption, OptionItem } from '@react-sigma/graph-search'
import { EdgeArrowProgram, NodePointProgram, NodeCircleProgram } from 'sigma/rendering'
import { NodeBorderProgram } from '@sigma/node-border'
import { EdgeCurvedArrowProgram, createEdgeCurveProgram } from '@sigma/edge-curve'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import FocusOnNode from '@/components/graph/FocusOnNode'
import LayoutsControl from '@/components/graph/LayoutsControl'
import GraphControl from '@/components/graph/GraphControl'
// import ThemeToggle from '@/components/ThemeToggle'
import ZoomControl from '@/components/graph/ZoomControl'
import FullScreenControl from '@/components/graph/FullScreenControl'
import ExportImageControl from '@/components/graph/ExportImageControl'
import Settings from '@/components/graph/Settings'
import GraphSearch from '@/components/graph/GraphSearch'
import GraphLabels from '@/components/graph/GraphLabels'
import ActionInspector from '@/components/graph/ActionInspector'
import GraphCanvasOverlay from '@/components/graph/GraphCanvasOverlay'
import SettingsDisplay from '@/components/graph/SettingsDisplay'
import Legend from '@/components/graph/Legend'
import LegendButton from '@/components/graph/LegendButton'
import FilterWorkbench from '@/components/graph/FilterWorkbench'
import useLightragGraph from '@/hooks/useLightragGraph'

import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import { labelColorDarkTheme, labelColorLightTheme } from '@/lib/constants'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import { getGraphInteractionSettings } from '@/utils/graphInteractionSettings'
import {
  DEFAULT_GRAPH_LABEL_FONT_SIZE,
  getEdgeLabelFontSize
} from '@/utils/graphLabelSize'

import '@react-sigma/core/lib/style.css'
import '@react-sigma/graph-search/lib/style.css'

// Function to create sigma settings based on theme
const createSigmaSettings = (
  isDarkTheme: boolean,
  graphLabelFontSize: number,
  enableEdgeEvents: boolean
): Partial<SigmaSettings> => ({
  allowInvalidContainer: true,
  defaultNodeType: 'default',
  defaultEdgeType: 'curvedNoArrow',
  renderEdgeLabels: false,
  edgeProgramClasses: {
    arrow: EdgeArrowProgram,
    curvedArrow: EdgeCurvedArrowProgram,
    curvedNoArrow: createEdgeCurveProgram()
  },
  nodeProgramClasses: {
    default: NodeBorderProgram,
    circel: NodeCircleProgram,
    point: NodePointProgram
  },
  labelGridCellSize: 60,
  labelRenderedSizeThreshold: 12,
  ...getGraphInteractionSettings(enableEdgeEvents),
  labelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelSize: getEdgeLabelFontSize(graphLabelFontSize),
  labelSize: graphLabelFontSize
  // minEdgeThickness: 2
  // labelFont: 'Lato, sans-serif'
})

const GraphViewer = () => {
  useLightragGraph()
  const { t } = useTranslation()

  const [isFilterWorkbenchCollapsed, setIsFilterWorkbenchCollapsed] = useState(false)
  const [isActionInspectorCollapsed, setIsActionInspectorCollapsed] = useState(false)
  const sigmaRef = useRef<any>(null)
  const prevTheme = useRef<string>('')

  const selectedNode = useGraphStore.use.selectedNode()
  const focusedNode = useGraphStore.use.focusedNode()
  const moveToSelectedNode = useGraphStore.use.moveToSelectedNode()
  const viewState = useGraphStore.use.viewState()
  const requestError = useGraphStore.use.requestError()

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showNodeSearchBar = useSettingsStore.use.showNodeSearchBar()
  const showLegend = useSettingsStore.use.showLegend()
  const graphLabelFontSize = useSettingsStore.use.graphLabelFontSize()
  const enableEdgeEvents = useSettingsStore.use.enableEdgeEvents()
  const theme = useSettingsStore.use.theme()

  const [isThemeSwitching, setIsThemeSwitching] = useState(false)

  // Memoize sigma settings to prevent unnecessary re-creation
  const memoizedSigmaSettings = useMemo(() => {
    const isDarkTheme = theme === 'dark'
    return createSigmaSettings(
      isDarkTheme,
      graphLabelFontSize || DEFAULT_GRAPH_LABEL_FONT_SIZE,
      enableEdgeEvents
    )
  }, [theme, graphLabelFontSize, enableEdgeEvents])

  // Detect theme changes and briefly show a loading overlay to avoid flash of
  // unstyled content. setState is inside setTimeout (async), not synchronously
  // in the effect body, so react-hooks/set-state-in-effect is not triggered.
  useEffect(() => {
    const isThemeChange = prevTheme.current && prevTheme.current !== theme
    if (isThemeChange) {
      prevTheme.current = theme

      const switchTimer = setTimeout(() => setIsThemeSwitching(true), 0)
      const timer = setTimeout(() => {
        setIsThemeSwitching(false)
      }, 150)

      return () => {
        clearTimeout(switchTimer)
        clearTimeout(timer)
      }
    }
    prevTheme.current = theme
  }, [theme])

  // Clean up sigma instance when component unmounts
  useEffect(() => {
    return () => {
      // TAB is mount twice in vite dev mode, this is a workaround

      const sigma = useGraphStore.getState().sigmaInstance;
      if (sigma) {
        try {
          // Destroy sigma，and clear WebGL context
          sigma.kill();
          useGraphStore.getState().setSigmaInstance(null);
        } catch (error) {
          console.error('Error cleaning up sigma instance:', error);
        }
      }
    };
  }, []);

  // Note: There was a useLayoutEffect hook here to set up the sigma instance and graph data,
  // but testing showed it wasn't executing or having any effect, while the backup mechanism
  // in GraphControl was sufficient. This code was removed to simplify implementation

  const onSearchFocus = useCallback((value: GraphSearchOption | null) => {
    if (value === null) useGraphStore.getState().setFocusedNode(null)
    else if (value.type === 'nodes') useGraphStore.getState().setFocusedNode(value.id)
  }, [])

  const onSearchSelect = useCallback((value: GraphSearchOption | null) => {
    if (value === null) {
      useGraphStore.getState().setSelectedNode(null)
    } else if (value.type === 'nodes') {
      useGraphStore.getState().setSelectedNode(value.id, true, 'search')
    }
  }, [])

  const autoFocusedNode = useMemo(() => focusedNode ?? selectedNode, [focusedNode, selectedNode])
  const searchInitSelectedNode = useMemo(
    (): OptionItem | null => (selectedNode ? { type: 'nodes', id: selectedNode } : null),
    [selectedNode]
  )
  const actionInspectorToggleLabel = useMemo(
    () =>
      isActionInspectorCollapsed
        ? t('graphPanel.workbench.actionInspector.actions.expand')
        : t('graphPanel.workbench.actionInspector.actions.collapse'),
    [isActionInspectorCollapsed, t]
  )

  return (
    <div className="relative h-full w-full overflow-hidden p-2">
      <div className="flex h-full w-full flex-col gap-2 lg:flex-row">
        <aside
          className={cn(
            'overflow-hidden transition-all duration-200 ease-out lg:shrink-0',
            isFilterWorkbenchCollapsed
              ? 'min-h-[60px] max-h-[60px] lg:max-h-none lg:min-h-0 lg:w-[56px]'
              : 'min-h-[240px] max-h-[42%] lg:max-h-none lg:min-h-0 lg:w-[300px] xl:w-[340px]'
          )}
        >
          <FilterWorkbench
            collapsed={isFilterWorkbenchCollapsed}
            onToggleCollapsed={() => setIsFilterWorkbenchCollapsed((collapsed) => !collapsed)}
          />
        </aside>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border">
          <SigmaContainer
            settings={memoizedSigmaSettings}
            className="!bg-background !size-full overflow-hidden"
            ref={sigmaRef}
          >
            <GraphControl />

            <FocusOnNode node={autoFocusedNode} move={moveToSelectedNode} />

            <div className="absolute top-2 left-2 right-2 flex flex-wrap items-start gap-2">
              <GraphLabels />
              {showNodeSearchBar && !isThemeSwitching && (
                <GraphSearch
                  value={searchInitSelectedNode}
                  onFocus={onSearchFocus}
                  onChange={onSearchSelect}
                />
              )}
            </div>

            <div className="bg-background/60 absolute bottom-2 left-2 flex flex-col rounded-xl border-2 backdrop-blur-lg">
              <LayoutsControl />
              <ZoomControl />
              <FullScreenControl />
              <ExportImageControl />
              <LegendButton />
              <Settings />
              {/* <ThemeToggle /> */}
            </div>

            {showLegend && (
              <div className="absolute bottom-10 right-2 z-0">
                <Legend className="bg-background/60 backdrop-blur-lg" />
              </div>
            )}

            {/* <div className="absolute bottom-2 right-2 flex flex-col rounded-xl border-2">
              <MiniMap width="100px" height="100px" />
            </div> */}

            <SettingsDisplay />
            <GraphCanvasOverlay
              viewState={viewState}
              message={requestError}
              themeSwitching={isThemeSwitching}
            />
          </SigmaContainer>
        </div>

        {showPropertyPanel && (
          <aside
            className={cn(
              'overflow-hidden transition-all duration-200 ease-out lg:shrink-0',
              isActionInspectorCollapsed
                ? 'min-h-[60px] max-h-[60px] lg:max-h-none lg:min-h-0 lg:w-[56px]'
                : 'min-h-[240px] max-h-[42%] lg:max-h-none lg:min-h-0 lg:w-[320px] xl:w-[360px]'
            )}
          >
            {isActionInspectorCollapsed ? (
              <div className="bg-background/80 flex h-full items-start justify-center rounded-xl border p-2 backdrop-blur-sm">
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setIsActionInspectorCollapsed(false)}
                  aria-label={actionInspectorToggleLabel}
                  tooltip={actionInspectorToggleLabel}
                >
                  <ChevronLeft />
                </Button>
              </div>
            ) : (
              <div className="relative h-full">
                <div className="absolute top-3 right-3 z-10">
                  <Button
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setIsActionInspectorCollapsed(true)}
                    aria-label={actionInspectorToggleLabel}
                    tooltip={actionInspectorToggleLabel}
                  >
                    <ChevronRight />
                  </Button>
                </div>
                <ActionInspector />
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

export default GraphViewer
