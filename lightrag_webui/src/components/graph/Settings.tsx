import { useState, useCallback, useEffect} from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import Checkbox from '@/components/ui/Checkbox'
import Button from '@/components/ui/Button'
import Separator from '@/components/ui/Separator'
import Input from '@/components/ui/Input'

import { controlButtonVariant } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import {
  DEFAULT_LAYOUT_PARAMS,
  saveGraphLayoutSettings
} from '@/utils/graphViewPersistence'
import { DEFAULT_GRAPH_LABEL_FONT_SIZE } from '@/utils/graphLabelSize'

import { SettingsIcon, Undo2, Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next';

/**
 * Component that displays a checkbox with a label.
 */
const LabeledCheckBox = ({
  checked,
  onCheckedChange,
  label
}: {
  checked: boolean
  onCheckedChange: () => void
  label: string
}) => {
  // Create unique ID using the label text converted to lowercase with spaces removed
  const id = `checkbox-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <label
        htmlFor={id}
        className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {label}
      </label>
    </div>
  )
}

/**
 * Component that displays a number input with a label.
 */
const LabeledNumberInput = ({
  value,
  onEditFinished,
  label,
  min,
  max,
  defaultValue,
  step
}: {
  value: number
  onEditFinished: (value: number) => void
  label: string
  min: number
  max?: number
  defaultValue?: number
  step?: number
}) => {
  const { t } = useTranslation();
  const [currentValue, setCurrentValue] = useState<number | null>(value)
  // Create unique ID using the label text converted to lowercase with spaces removed
  const id = `input-${label.toLowerCase().replace(/\s+/g, '-')}`;

  useEffect(() => {
    setCurrentValue(value)
  }, [value])

  const onValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value.trim()
      if (text.length === 0) {
        setCurrentValue(null)
        return
      }
      const newValue = step ? parseFloat(text) : Number.parseInt(text)
      if (!isNaN(newValue) && newValue !== currentValue) {
        if (min !== undefined && newValue < min) {
          return
        }
        if (max !== undefined && newValue > max) {
          return
        }
        setCurrentValue(newValue)
      }
    },
    [currentValue, min, max, step]
  )

  const onBlur = useCallback(() => {
    if (currentValue !== null && value !== currentValue) {
      onEditFinished(currentValue)
    }
  }, [value, currentValue, onEditFinished])

  const handleReset = useCallback(() => {
    if (defaultValue !== undefined && value !== defaultValue) {
      setCurrentValue(defaultValue)
      onEditFinished(defaultValue)
    }
  }, [defaultValue, value, onEditFinished])

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {label}
      </label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="number"
          value={currentValue === null ? '' : currentValue}
          onChange={onValueChange}
          className="h-6 w-full min-w-0 pr-1"
          min={min}
          max={max}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onBlur()
            }
          }}
        />
        {defaultValue !== undefined && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
            onClick={handleReset}
            type="button"
            title={t('graphPanel.sideBar.settings.resetToDefault')}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Component that displays a popover with settings options.
 */
export default function Settings() {
  const [opened, setOpened] = useState<boolean>(false)

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showNodeSearchBar = useSettingsStore.use.showNodeSearchBar()
  const showNodeLabel = useSettingsStore.use.showNodeLabel()
  const graphLabelFontSize = useSettingsStore.use.graphLabelFontSize()
  const enableEdgeEvents = useSettingsStore.use.enableEdgeEvents()
  const enableNodeDrag = useSettingsStore.use.enableNodeDrag()
  const enableHideUnselectedEdges = useSettingsStore.use.enableHideUnselectedEdges()
  const showEdgeLabel = useSettingsStore.use.showEdgeLabel()
  const enableSearchLinkedDrag = useSettingsStore.use.enableSearchLinkedDrag()
  const minEdgeSize = useSettingsStore.use.minEdgeSize()
  const maxEdgeSize = useSettingsStore.use.maxEdgeSize()
  const graphQueryMaxDepth = useSettingsStore.use.graphQueryMaxDepth()
  const graphMaxNodes = useSettingsStore.use.graphMaxNodes()
  const backendMaxGraphNodes = useSettingsStore.use.backendMaxGraphNodes()
  const graphLayoutMaxIterations = useSettingsStore.use.graphLayoutMaxIterations()
  const graphLayoutRepulsion = useSettingsStore.use.graphLayoutRepulsion()
  const graphLayoutGravity = useSettingsStore.use.graphLayoutGravity()
  const graphLayoutMargin = useSettingsStore.use.graphLayoutMargin()
  const graphLayoutAttraction = useSettingsStore.use.graphLayoutAttraction()
  const graphLayoutInertia = useSettingsStore.use.graphLayoutInertia()
  const graphLayoutMaxMove = useSettingsStore.use.graphLayoutMaxMove()
  const graphLayoutExpansion = useSettingsStore.use.graphLayoutExpansion()
  const graphLayoutGridSize = useSettingsStore.use.graphLayoutGridSize()
  const graphLayoutRatio = useSettingsStore.use.graphLayoutRatio()
  const graphLayoutSpeed = useSettingsStore.use.graphLayoutSpeed()

  const enableHealthCheck = useSettingsStore.use.enableHealthCheck()

  // Random graph: only loaded in dev mode to avoid bundling @faker-js/faker (3MB) in production
  const handleGenerateRandomGraph = useCallback(async () => {
    const { default: generateRandomGraph } = await import('@/hooks/useRandomGraph')
    const graph = generateRandomGraph()
    useGraphStore.getState().setSigmaGraph(graph)
  }, [])

  const setEnableNodeDrag = useCallback(
    () => useSettingsStore.setState((pre) => ({ enableNodeDrag: !pre.enableNodeDrag })),
    []
  )
  const setEnableEdgeEvents = useCallback(
    () => useSettingsStore.setState((pre) => ({ enableEdgeEvents: !pre.enableEdgeEvents })),
    []
  )
  const setEnableHideUnselectedEdges = useCallback(
    () =>
      useSettingsStore.setState((pre) => ({
        enableHideUnselectedEdges: !pre.enableHideUnselectedEdges
      })),
    []
  )
  const setShowEdgeLabel = useCallback(
    () =>
      useSettingsStore.setState((pre) => ({
        showEdgeLabel: !pre.showEdgeLabel
      })),
    []
  )
  const setEnableSearchLinkedDrag = useCallback(
    () =>
      useSettingsStore.setState((pre) => ({
        enableSearchLinkedDrag: !pre.enableSearchLinkedDrag
      })),
    []
  )

  //
  const setShowPropertyPanel = useCallback(
    () => useSettingsStore.setState((pre) => ({ showPropertyPanel: !pre.showPropertyPanel })),
    []
  )

  const setShowNodeSearchBar = useCallback(
    () => useSettingsStore.setState((pre) => ({ showNodeSearchBar: !pre.showNodeSearchBar })),
    []
  )

  const setShowNodeLabel = useCallback(
    () => useSettingsStore.setState((pre) => ({ showNodeLabel: !pre.showNodeLabel })),
    []
  )

  const setEnableHealthCheck = useCallback(
    () => useSettingsStore.setState((pre) => ({ enableHealthCheck: !pre.enableHealthCheck })),
    []
  )

  const setGraphQueryMaxDepth = useCallback((depth: number) => {
    if (depth < 1) return
    useSettingsStore.setState({ graphQueryMaxDepth: depth })
    useGraphStore.getState().setGraphDataFetchAttempted(false)
    useGraphStore.getState().incrementGraphDataVersion()
  }, [])

  const setGraphMaxNodes = useCallback((nodes: number) => {
    const maxLimit = backendMaxGraphNodes || 10000
    if (nodes < 1 || nodes > maxLimit) return
    useSettingsStore.getState().setGraphMaxNodes(nodes, true)
  }, [backendMaxGraphNodes])

  const setGraphLayoutMaxIterations = useCallback((iterations: number) => {
    if (iterations < 1) return
    useSettingsStore.setState({ graphLayoutMaxIterations: iterations })
  }, [])

  const setGraphLabelFontSize = useCallback((fontSize: number) => {
    if (fontSize < 8 || fontSize > 24) return
    useSettingsStore.setState({ graphLabelFontSize: fontSize })
  }, [])

  const setGraphLayoutRepulsion = useCallback((repulsion: number) => {
    if (repulsion < 0.001) return
    useSettingsStore.setState({ graphLayoutRepulsion: repulsion })
  }, [])

  const setGraphLayoutGravity = useCallback((gravity: number) => {
    if (gravity < 0.001) return
    useSettingsStore.setState({ graphLayoutGravity: gravity })
  }, [])

  const setGraphLayoutMargin = useCallback((margin: number) => {
    if (margin < 1) return
    useSettingsStore.setState({ graphLayoutMargin: margin })
  }, [])

  const setGraphLayoutAttraction = useCallback((attraction: number) => {
    if (attraction < 0.0001) return
    useSettingsStore.setState({ graphLayoutAttraction: attraction })
  }, [])

  const setGraphLayoutInertia = useCallback((inertia: number) => {
    if (inertia < 0 || inertia > 1) return
    useSettingsStore.setState({ graphLayoutInertia: inertia })
  }, [])

  const setGraphLayoutMaxMove = useCallback((maxMove: number) => {
    if (maxMove < 1) return
    useSettingsStore.setState({ graphLayoutMaxMove: maxMove })
  }, [])

  const setGraphLayoutExpansion = useCallback((expansion: number) => {
    if (expansion < 1) return
    useSettingsStore.setState({ graphLayoutExpansion: expansion })
  }, [])

  const setGraphLayoutGridSize = useCallback((gridSize: number) => {
    if (gridSize < 1) return
    useSettingsStore.setState({ graphLayoutGridSize: gridSize })
  }, [])

  const setGraphLayoutRatio = useCallback((ratio: number) => {
    if (ratio <= 0) return
    useSettingsStore.setState({ graphLayoutRatio: ratio })
  }, [])

  const setGraphLayoutSpeed = useCallback((speed: number) => {
    if (speed <= 0) return
    useSettingsStore.setState({ graphLayoutSpeed: speed })
  }, [])

  const { t } = useTranslation();

  const saveSettings = () => {
    const state = useSettingsStore.getState()
    const graphState = useGraphStore.getState()
    saveGraphLayoutSettings(
      {
        workspace: state.currentWorkspace,
        queryLabel: graphState.lastSuccessfulQueryLabel
      },
      state
    )
    setOpened(false)
  }

  return (
    <>
      <Popover
        open={opened}
        onOpenChange={(nextOpened) => {
          if (!nextOpened) {
            saveSettings()
          }
          setOpened(nextOpened)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant={controlButtonVariant}
            tooltip={t('graphPanel.sideBar.settings.settings')}
            size="icon"
          >
            <SettingsIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={8}
          collisionPadding={5}
          className="w-[min(32rem,calc(100vw-1rem))] p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="max-h-[min(78vh,42rem)] overflow-y-auto p-3">
            <div className="flex flex-col gap-3">
            <LabeledCheckBox
              checked={enableHealthCheck}
              onCheckedChange={setEnableHealthCheck}
              label={t('graphPanel.sideBar.settings.healthCheck')}
            />

            <Separator />

            <LabeledCheckBox
              checked={showPropertyPanel}
              onCheckedChange={setShowPropertyPanel}
              label={t('graphPanel.sideBar.settings.showPropertyPanel')}
            />
            <LabeledCheckBox
              checked={showNodeSearchBar}
              onCheckedChange={setShowNodeSearchBar}
              label={t('graphPanel.sideBar.settings.showSearchBar')}
            />

            <Separator />

            <LabeledCheckBox
              checked={showNodeLabel}
              onCheckedChange={setShowNodeLabel}
              label={t('graphPanel.sideBar.settings.showNodeLabel')}
            />
            <LabeledNumberInput
              value={graphLabelFontSize}
              onEditFinished={setGraphLabelFontSize}
              label={t('graphPanel.sideBar.settings.graphLabelFontSize')}
              min={8}
              max={24}
              defaultValue={DEFAULT_GRAPH_LABEL_FONT_SIZE}
            />
            <LabeledCheckBox
              checked={enableNodeDrag}
              onCheckedChange={setEnableNodeDrag}
              label={t('graphPanel.sideBar.settings.nodeDraggable')}
            />
            <LabeledCheckBox
              checked={enableSearchLinkedDrag}
              onCheckedChange={setEnableSearchLinkedDrag}
              label={t('graphPanel.sideBar.settings.searchLinkedDrag')}
            />

            <Separator />

            <LabeledCheckBox
              checked={showEdgeLabel}
              onCheckedChange={setShowEdgeLabel}
              label={t('graphPanel.sideBar.settings.showEdgeLabel')}
            />
            <LabeledCheckBox
              checked={enableHideUnselectedEdges}
              onCheckedChange={setEnableHideUnselectedEdges}
              label={t('graphPanel.sideBar.settings.hideUnselectedEdges')}
            />
            <LabeledCheckBox
              checked={enableEdgeEvents}
              onCheckedChange={setEnableEdgeEvents}
              label={t('graphPanel.sideBar.settings.edgeEvents')}
            />

            <div className="flex flex-col gap-2">
              <label htmlFor="edge-size-min" className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {t('graphPanel.sideBar.settings.edgeSizeRange')}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="edge-size-min"
                  type="number"
                  value={minEdgeSize}
                  onChange={(e) => {
                    const newValue = Number(e.target.value);
                    if (!isNaN(newValue) && newValue >= 1 && newValue <= maxEdgeSize) {
                      useSettingsStore.setState({ minEdgeSize: newValue });
                    }
                  }}
                  className="h-6 w-16 min-w-0 pr-1"
                  min={1}
                  max={Math.min(maxEdgeSize, 10)}
                />
                <span>-</span>
                <div className="flex items-center gap-1">
                  <Input
                    id="edge-size-max"
                    type="number"
                    value={maxEdgeSize}
                    onChange={(e) => {
                      const newValue = Number(e.target.value);
                      if (!isNaN(newValue) && newValue >= minEdgeSize && newValue >= 1 && newValue <= 10) {
                        useSettingsStore.setState({ maxEdgeSize: newValue });
                      }
                    }}
                    className="h-6 w-16 min-w-0 pr-1"
                    min={minEdgeSize}
                    max={10}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
                    onClick={() => useSettingsStore.setState({ minEdgeSize: 1, maxEdgeSize: 5 })}
                    type="button"
                    title={t('graphPanel.sideBar.settings.resetToDefault')}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.maxQueryDepth')}
                min={1}
                value={graphQueryMaxDepth}
                defaultValue={3}
                onEditFinished={setGraphQueryMaxDepth}
              />
              <LabeledNumberInput
                label={`${t('graphPanel.sideBar.settings.maxNodes')} (≤ ${backendMaxGraphNodes || 10000})`}
                min={1}
                max={backendMaxGraphNodes || 10000}
                value={graphMaxNodes}
                defaultValue={backendMaxGraphNodes || 10000}
                onEditFinished={setGraphMaxNodes}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.maxLayoutIterations')}
                min={1}
                max={30}
                value={graphLayoutMaxIterations}
                defaultValue={15}
                onEditFinished={setGraphLayoutMaxIterations}
              />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutRepulsion')}
                min={0.001}
                max={1}
                value={graphLayoutRepulsion}
                defaultValue={0.02}
                step={0.001}
                onEditFinished={setGraphLayoutRepulsion}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutGravity')}
                min={0.001}
                max={1}
                value={graphLayoutGravity}
                defaultValue={0.02}
                step={0.001}
                onEditFinished={setGraphLayoutGravity}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutMargin')}
                min={1}
                max={100}
                value={graphLayoutMargin}
                defaultValue={DEFAULT_LAYOUT_PARAMS.margin}
                onEditFinished={setGraphLayoutMargin}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutAttraction')}
                min={0.0001}
                max={0.01}
                value={graphLayoutAttraction}
                defaultValue={DEFAULT_LAYOUT_PARAMS.attraction}
                step={0.0001}
                onEditFinished={setGraphLayoutAttraction}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutInertia')}
                min={0}
                max={1}
                value={graphLayoutInertia}
                defaultValue={DEFAULT_LAYOUT_PARAMS.inertia}
                step={0.01}
                onEditFinished={setGraphLayoutInertia}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutMaxMove')}
                min={1}
                max={500}
                value={graphLayoutMaxMove}
                defaultValue={DEFAULT_LAYOUT_PARAMS.maxMove}
                onEditFinished={setGraphLayoutMaxMove}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutExpansion')}
                min={1}
                max={5}
                value={graphLayoutExpansion}
                defaultValue={DEFAULT_LAYOUT_PARAMS.expansion}
                step={0.1}
                onEditFinished={setGraphLayoutExpansion}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutGridSize')}
                min={1}
                max={20}
                value={graphLayoutGridSize}
                defaultValue={DEFAULT_LAYOUT_PARAMS.gridSize}
                onEditFinished={setGraphLayoutGridSize}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutRatio')}
                min={0.1}
                max={10}
                value={graphLayoutRatio}
                defaultValue={DEFAULT_LAYOUT_PARAMS.ratio}
                step={0.1}
                onEditFinished={setGraphLayoutRatio}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutSpeed')}
                min={0.1}
                max={10}
                value={graphLayoutSpeed}
                defaultValue={DEFAULT_LAYOUT_PARAMS.speed}
                step={0.1}
                onEditFinished={setGraphLayoutSpeed}
              />
            </div>
            {/* Development/Testing Section - Only visible in development mode */}
            {import.meta.env.DEV && (
              <>
                <Separator />

                <div className="flex flex-col gap-2">
                  <label className="text-sm leading-none font-medium text-muted-foreground">
                    Dev Options
                  </label>
                  <Button
                    onClick={handleGenerateRandomGraph}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                    Gen Random Graph
                  </Button>
                </div>

                <Separator />
              </>
            )}
            <Button
              onClick={saveSettings}
              variant="outline"
              size="sm"
              className="ml-auto px-4"
            >
              {t('graphPanel.sideBar.settings.save')}
            </Button>

            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
