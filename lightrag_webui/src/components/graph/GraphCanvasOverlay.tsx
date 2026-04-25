import GraphEmptyState from './GraphEmptyState'
import type { GraphViewState } from '@/stores/graph'

const GraphCanvasOverlay = ({
  viewState,
  message,
  themeSwitching = false
}: {
  viewState: GraphViewState
  message?: string | null
  themeSwitching?: boolean
}) => {
  const effectiveState = themeSwitching ? 'theme_loading' : viewState
  if (effectiveState === 'ready' || effectiveState === 'idle') {
    return null
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <GraphEmptyState state={effectiveState} message={message} />
    </div>
  )
}

export default GraphCanvasOverlay
