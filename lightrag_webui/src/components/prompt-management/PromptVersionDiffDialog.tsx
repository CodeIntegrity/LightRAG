import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'

type PromptVersionDiffDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  diffData: {
    changes: Record<string, { before: unknown; after: unknown }>
  } | null
}

type DiffLine = {
  type: 'context' | 'add' | 'remove'
  content: string
  lineNumBefore: number | null
  lineNumAfter: number | null
}

const highlightVariables = (text: string): React.ReactNode[] => {
  const parts = text.split(/(\{\w+\})/g)
  return parts.map((part, index) => {
    if (/^\{\w+\}$/.test(part)) {
      return (
        <span key={index} className="rounded bg-amber-100 px-0.5 font-mono text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          {part}
        </span>
      )
    }
    return <span key={index}>{part}</span>
  })
}

const computeLineDiff = (before: string, after: string): DiffLine[] => {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  // Simple LCS-based diff for line-level changes
  const m = beforeLines.length
  const n = afterLines.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find diff
  const lines: DiffLine[] = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      lines.push({
        type: 'context',
        content: beforeLines[i - 1],
        lineNumBefore: i,
        lineNumAfter: j
      })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lines.push({
        type: 'add',
        content: afterLines[j - 1],
        lineNumBefore: null,
        lineNumAfter: j
      })
      j--
    } else {
      lines.push({
        type: 'remove',
        content: beforeLines[i - 1],
        lineNumBefore: i,
        lineNumAfter: null
      })
      i--
    }
  }

  return lines.reverse()
}

const serializeValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join('\n')
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
}

export default function PromptVersionDiffDialog({
  open,
  onOpenChange,
  diffData
}: PromptVersionDiffDialogProps) {
  const { t } = useTranslation()
  const entries = Object.entries(diffData?.changes || {})
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified')

  const diffResults = useMemo(() => {
    return entries.map(([key, value]) => {
      const beforeStr = serializeValue(value.before)
      const afterStr = serializeValue(value.after)
      const lines = computeLineDiff(beforeStr, afterStr)

      // Count changes
      const addedLines = lines.filter((l) => l.type === 'add').length
      const removedLines = lines.filter((l) => l.type === 'remove').length
      const hasChanges = addedLines > 0 || removedLines > 0

      return { key, lines, addedLines, removedLines, hasChanges }
    })
  }, [entries])

  const totalChanges = diffResults.reduce((sum, d) => sum + d.addedLines + d.removedLines, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>{t('promptManagement.versionDiffTitle')}</DialogTitle>
              <DialogDescription>
                {t('promptManagement.versionDiffDescription')}
                {totalChanges > 0 && (
                  <span className="ml-2 text-blue-600 dark:text-blue-400">
                    (+{diffResults.reduce((s, d) => s + d.addedLines, 0)} / -{diffResults.reduce((s, d) => s + d.removedLines, 0)})
                  </span>
                )}
              </DialogDescription>
            </div>
            {entries.length > 0 && (
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={viewMode === 'unified' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setViewMode('unified')}
                >
                  {t('promptManagement.diffUnified')}
                </Button>
                <Button
                  type="button"
                  variant={viewMode === 'split' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setViewMode('split')}
                >
                  {t('promptManagement.diffSplit')}
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-auto">
          {diffResults.length === 0 || diffResults.every((d) => !d.hasChanges) ? (
            <div className="text-sm text-muted-foreground">{t('promptManagement.noChanges')}</div>
          ) : (
            diffResults.map((result) => {
              if (!result.hasChanges) return null

              return (
                <div key={result.key} className="rounded-lg border">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="font-mono text-xs font-semibold">{result.key}</span>
                    <span className="text-[10px] text-muted-foreground">
                      <span className="text-red-600 dark:text-red-400">-{result.removedLines}</span>
                      {' / '}
                      <span className="text-blue-600 dark:text-blue-400">+{result.addedLines}</span>
                    </span>
                  </div>

                  {viewMode === 'unified' ? (
                    <div className="overflow-auto">
                      <pre className="text-xs leading-5 font-mono">
                        {result.lines.map((line, idx) => {
                          const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
                          const bgClass = line.type === 'add'
                            ? 'bg-blue-50/60 dark:bg-blue-950/30'
                            : line.type === 'remove'
                              ? 'bg-red-50/60 dark:bg-red-950/30'
                              : ''
                          const textClass = line.type === 'add'
                            ? 'text-blue-800 dark:text-blue-300'
                            : line.type === 'remove'
                              ? 'text-red-800 dark:text-red-300'
                              : 'text-muted-foreground'

                          return (
                            <div key={idx} className={`flex ${bgClass}`}>
                              <span className="inline-block w-10 shrink-0 select-none text-right pr-2 text-[10px] text-muted-foreground/60">
                                {line.lineNumBefore ?? line.lineNumAfter ?? ''}
                              </span>
                              <span className={`inline-block w-4 shrink-0 select-none text-center ${textClass}`}>
                                {prefix}
                              </span>
                              <span className={`flex-1 px-2 ${textClass}`}>
                                {line.type === 'context'
                                  ? line.content
                                  : highlightVariables(line.content)}
                              </span>
                            </div>
                          )
                        })}
                      </pre>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 divide-x">
                      <div className="overflow-auto">
                        <div className="bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                          Before
                        </div>
                        <pre className="text-xs leading-5 font-mono">
                          {result.lines
                            .filter((l) => l.type === 'context' || l.type === 'remove')
                            .map((line, idx) => (
                              <div key={idx} className={line.type === 'remove' ? 'bg-red-50/60 dark:bg-red-950/30 text-red-800 dark:text-red-300' : ''}>
                                <span className="inline-block w-8 shrink-0 select-none text-right pr-2 text-[10px] text-muted-foreground/60">
                                  {line.lineNumBefore ?? ''}
                                </span>
                                <span className="px-1">{line.content}</span>
                              </div>
                            ))}
                        </pre>
                      </div>
                      <div className="overflow-auto">
                        <div className="bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                          After
                        </div>
                        <pre className="text-xs leading-5 font-mono">
                          {result.lines
                            .filter((l) => l.type === 'context' || l.type === 'add')
                            .map((line, idx) => (
                              <div key={idx} className={line.type === 'add' ? 'bg-blue-50/60 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300' : ''}>
                                <span className="inline-block w-8 shrink-0 select-none text-right pr-2 text-[10px] text-muted-foreground/60">
                                  {line.lineNumAfter ?? ''}
                                </span>
                                <span className="px-1">
                                  {line.type === 'context' ? line.content : highlightVariables(line.content)}
                                </span>
                              </div>
                            ))}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
