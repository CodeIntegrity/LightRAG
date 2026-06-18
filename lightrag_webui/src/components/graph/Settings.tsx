import { useState, useCallback, useEffect} from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import Checkbox from '@/components/ui/Checkbox'
import Button from '@/components/ui/Button'
import Separator from '@/components/ui/Separator'
import Input from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/Select'
import type { GraphClusterBy } from '@/utils/forceAtlas2Layout'
import { DEFAULT_FA2_SCALING_RATIO, DEFAULT_FA2_GRAVITY } from '@/utils/forceAtlas2Layout'

import { controlButtonVariant } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import {
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
  step,
  inputClassName
}: {
  value: number
  onEditFinished: (value: number) => void
  label: string
  min: number
  max?: number
  defaultValue?: number
  step?: number
  inputClassName?: string
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
          className={`h-6 min-w-0 pr-1 ${inputClassName ?? 'w-full'}`}
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
 * Group header that labels what a block of settings controls.
 */
const SectionTitle = ({ children }: { children: string }) => (
  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </div>
)

/**
 * Component that displays a popover with settings options.
 */
export default function Settings() {
  const [opened, setOpened] = useState<boolean>(false)
  const { t } = useTranslation();

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showNodeSearchBar = useSettingsStore.use.showNodeSearchBar()
  const showNodeLabel = useSettingsStore.use.showNodeLabel()
  const graphColorScheme = useSettingsStore.use.graphColorScheme()
  const graphClusterBy = useSettingsStore.use.graphClusterBy()
  const setGraphClusterBy = useSettingsStore.use.setGraphClusterBy()
  const graphLabelFontSize = useSettingsStore.use.graphLabelFontSize()
  const enableEdgeEvents = useSettingsStore.use.enableEdgeEvents()
  const enableNodeDrag = useSettingsStore.use.enableNodeDrag()
  const enableHideUnselectedEdges = useSettingsStore.use.enableHideUnselectedEdges()
  const showEdgeLabel = useSettingsStore.use.showEdgeLabel()
  const showDirectionalArrows = useSettingsStore.use.showDirectionalArrows()
  const colorEdgesByDirection = useSettingsStore.use.colorEdgesByDirection()
  const minEdgeSize = useSettingsStore.use.minEdgeSize()
  const maxEdgeSize = useSettingsStore.use.maxEdgeSize()
  const graphQueryMaxDepth = useSettingsStore.use.graphQueryMaxDepth()
  const graphMaxNodes = useSettingsStore.use.graphMaxNodes()
  const backendMaxGraphNodes = useSettingsStore.use.backendMaxGraphNodes()
  const graphMaxNodesLimit = backendMaxGraphNodes ?? undefined
  const graphMaxNodesLabel = backendMaxGraphNodes
    ? `${t('graphPanel.sideBar.settings.maxNodes')} (<= ${backendMaxGraphNodes})`
    : t('graphPanel.sideBar.settings.maxNodes')
  const graphLayoutMaxIterations = useSettingsStore.use.graphLayoutMaxIterations()
  const graphLayoutScalingRatio = useSettingsStore.use.graphLayoutScalingRatio()
  const graphLayoutCenterGravity = useSettingsStore.use.graphLayoutCenterGravity()

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
  const setColorEdgesByDirection = useCallback(
    () =>
      useSettingsStore.setState((pre) => ({
        colorEdgesByDirection: !pre.colorEdgesByDirection
      })),
    []
  )
  const setShowDirectionalArrows = useCallback(
    () =>
      useSettingsStore.setState((pre) => ({
        showDirectionalArrows: !pre.showDirectionalArrows
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

  const setColorByCommunity = useCallback(
    () =>
      useSettingsStore.setState((pre) => ({
        graphColorScheme: pre.graphColorScheme === 'community' ? 'type' : 'community'
      })),
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
    if (nodes < 1 || (graphMaxNodesLimit !== undefined && nodes > graphMaxNodesLimit)) return
    useSettingsStore.getState().setGraphMaxNodes(nodes, true)
  }, [graphMaxNodesLimit])

  const setGraphLayoutMaxIterations = useCallback((iterations: number) => {
    if (iterations < 1) return
    useSettingsStore.setState({ graphLayoutMaxIterations: iterations })
  }, [])

  const setGraphLabelFontSize = useCallback((fontSize: number) => {
    if (fontSize < 8 || fontSize > 24) return
    useSettingsStore.setState({ graphLabelFontSize: fontSize })
  }, [])

  const setGraphLayoutScalingRatio = useCallback((ratio: number) => {
    if (ratio <= 0) return
    useSettingsStore.setState({ graphLayoutScalingRatio: ratio })
  }, [])

  const setGraphLayoutCenterGravity = useCallback((gravity: number) => {
    if (gravity < 0) return
    useSettingsStore.setState({ graphLayoutCenterGravity: gravity })
  }, [])

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
            <SectionTitle>{t('graphPanel.sideBar.settings.groupSystem')}</SectionTitle>
            <LabeledCheckBox
              checked={enableHealthCheck}
              onCheckedChange={setEnableHealthCheck}
              label={t('graphPanel.sideBar.settings.healthCheck')}
            />

            <Separator />

            <SectionTitle>{t('graphPanel.sideBar.settings.groupData')}</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.maxQueryDepth')}
                min={1}
                value={graphQueryMaxDepth}
                defaultValue={3}
                onEditFinished={setGraphQueryMaxDepth}
              />
              <LabeledNumberInput
                label={graphMaxNodesLabel}
                min={1}
                max={graphMaxNodesLimit}
                value={graphMaxNodes}
                defaultValue={backendMaxGraphNodes ?? undefined}
                onEditFinished={setGraphMaxNodes}
              />
            </div>

            <Separator />

            <SectionTitle>{t('graphPanel.sideBar.settings.groupInterface')}</SectionTitle>
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

            <SectionTitle>{t('graphPanel.sideBar.settings.groupNode')}</SectionTitle>
            <LabeledCheckBox
              checked={showNodeLabel}
              onCheckedChange={setShowNodeLabel}
              label={t('graphPanel.sideBar.settings.showNodeLabel')}
            />
            <LabeledCheckBox
              checked={graphColorScheme === 'community'}
              onCheckedChange={setColorByCommunity}
              label={t('graphPanel.sideBar.settings.colorByCommunity')}
            />
            <LabeledNumberInput
              value={graphLabelFontSize}
              onEditFinished={setGraphLabelFontSize}
              label={t('graphPanel.sideBar.settings.graphLabelFontSize')}
              min={8}
              max={24}
              defaultValue={DEFAULT_GRAPH_LABEL_FONT_SIZE}
              inputClassName="w-24"
            />
            <LabeledCheckBox
              checked={enableNodeDrag}
              onCheckedChange={setEnableNodeDrag}
              label={t('graphPanel.sideBar.settings.nodeDraggable')}
            />

            <Separator />

            <SectionTitle>{t('graphPanel.sideBar.settings.groupEdge')}</SectionTitle>
            <LabeledCheckBox
              checked={showEdgeLabel}
              onCheckedChange={setShowEdgeLabel}
              label={t('graphPanel.sideBar.settings.showEdgeLabel')}
            />
            <LabeledCheckBox
              checked={showDirectionalArrows}
              onCheckedChange={setShowDirectionalArrows}
              label={t('graphPanel.sideBar.settings.showDirectionalArrows')}
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
            <LabeledCheckBox
              checked={colorEdgesByDirection}
              onCheckedChange={setColorEdgesByDirection}
              label={t('graphPanel.sideBar.settings.colorEdgesByDirection')}
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

            <SectionTitle>{t('graphPanel.sideBar.settings.groupLayout')}</SectionTitle>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm leading-none font-medium">
                {t('graphPanel.sideBar.settings.clusterBy')}
              </label>
              <Select
                value={graphClusterBy}
                onValueChange={(value) => setGraphClusterBy(value as GraphClusterBy)}
              >
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('graphPanel.sideBar.settings.clusterByNone')}</SelectItem>
                  <SelectItem value="type">{t('graphPanel.sideBar.settings.clusterByType')}</SelectItem>
                  <SelectItem value="community">{t('graphPanel.sideBar.settings.clusterByCommunity')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.maxLayoutIterations')}
                min={1}
                max={30}
                value={graphLayoutMaxIterations}
                defaultValue={15}
                onEditFinished={setGraphLayoutMaxIterations}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutScalingRatio')}
                min={0.1}
                max={20}
                value={graphLayoutScalingRatio}
                defaultValue={DEFAULT_FA2_SCALING_RATIO}
                step={0.1}
                onEditFinished={setGraphLayoutScalingRatio}
              />
              <LabeledNumberInput
                label={t('graphPanel.sideBar.settings.layoutCenterGravity')}
                min={0}
                max={20}
                value={graphLayoutCenterGravity}
                defaultValue={DEFAULT_FA2_GRAVITY}
                step={0.1}
                onEditFinished={setGraphLayoutCenterGravity}
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
