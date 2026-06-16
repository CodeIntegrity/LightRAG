import { cn } from '@/lib/utils'
import { useBackendState } from '@/stores/state'
import { useEffect, useState } from 'react'
import StatusDialog from './StatusDialog'
import { useTranslation } from 'react-i18next'

interface StatusIndicatorProps {
  compact?: boolean
  className?: string
}

const StatusIndicator = ({ compact = false, className }: StatusIndicatorProps) => {
  const { t } = useTranslation()
  const health = useBackendState.use.health()
  const lastCheckTime = useBackendState.use.lastCheckTime()
  const status = useBackendState.use.status()
  const [animate, setAnimate] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const statusLabel = health
    ? t('graphPanel.statusIndicator.connected')
    : t('graphPanel.statusIndicator.disconnected')

  // listen to health change
  useEffect(() => {
    const animTimer = setTimeout(() => setAnimate(true), 0)
    const timer = setTimeout(() => setAnimate(false), 300)
    return () => {
      clearTimeout(animTimer)
      clearTimeout(timer)
    }
  }, [lastCheckTime])

  return (
    <>
    <button
      type="button"
      className={cn(
        'flex items-center gap-2 opacity-80 select-none',
        compact ? 'h-8 rounded-md px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' : '',
        'cursor-pointer',
        className
      )}
      onClick={() => setDialogOpen(true)}
      aria-label={statusLabel}
      title={statusLabel}
    >
      <div
        className="flex cursor-pointer items-center gap-2"
      >
        <div
          className={cn(
            compact ? 'h-2.5 w-2.5' : 'h-3 w-3',
            'rounded-full transition-all duration-300',
            'shadow-[0_0_8px_rgba(0,0,0,0.2)]',
            health ? 'bg-green-500' : 'bg-red-500',
            animate && 'scale-125',
            animate && health && 'shadow-[0_0_12px_rgba(34,197,94,0.4)]',
            animate && !health && 'shadow-[0_0_12px_rgba(239,68,68,0.4)]'
          )}
        />
        {!compact && <span className="text-muted-foreground text-xs">{statusLabel}</span>}
      </div>
    </button>

      <StatusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        status={status}
      />
    </>
  )
}

export default StatusIndicator
