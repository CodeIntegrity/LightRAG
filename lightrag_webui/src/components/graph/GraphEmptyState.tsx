import { AlertCircle, LoaderCircle, ShieldAlert, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { GraphViewState } from '@/stores/graph'

const stateIconMap: Record<GraphViewState | 'theme_loading', typeof LoaderCircle> = {
  idle: Sparkles,
  loading: LoaderCircle,
  ready: Sparkles,
  empty: Sparkles,
  auth_error: ShieldAlert,
  error: AlertCircle,
  theme_loading: LoaderCircle
}

const GraphEmptyState = ({
  state,
  message
}: {
  state: GraphViewState | 'theme_loading'
  message?: string | null
}) => {
  const { t } = useTranslation()
  const Icon = stateIconMap[state]
  const isLoading = state === 'loading' || state === 'theme_loading'

  const titleKey =
    state === 'empty'
      ? 'graphPanel.overlay.emptyTitle'
      : state === 'auth_error'
        ? 'graphPanel.overlay.authErrorTitle'
        : state === 'error'
          ? 'graphPanel.overlay.errorTitle'
          : 'graphPanel.overlay.loadingTitle'

  const descriptionKey =
    state === 'empty'
      ? 'graphPanel.overlay.emptyDescription'
      : state === 'auth_error'
        ? 'graphPanel.overlay.authErrorDescription'
        : state === 'error'
          ? 'graphPanel.overlay.errorDescription'
          : state === 'theme_loading'
            ? 'graphPanel.switchingTheme'
            : 'graphPanel.loadingGraph'

  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <div className="bg-background/90 rounded-full border p-3 shadow-sm">
        <Icon className={`h-6 w-6 ${isLoading ? 'animate-spin' : ''}`} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
        <p className="text-muted-foreground text-sm">{message || t(descriptionKey)}</p>
      </div>
    </div>
  )
}

export default GraphEmptyState
