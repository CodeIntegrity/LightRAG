import { useMemo, useState } from 'react'
import { PromptVersionRecord } from '@/api/lightrag'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'

type PromptVersionListProps = {
  versions: PromptVersionRecord[]
  activeVersionId: string | null
  selectedVersionId: string | null
  onSelectVersion: (versionId: string) => void
  defaultVersions?: PromptVersionRecord[]
  onRollbackToVersion?: (version: PromptVersionRecord) => void
}

const formatDate = (iso: string): string => {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

export default function PromptVersionList({
  versions,
  activeVersionId,
  selectedVersionId,
  onSelectVersion,
  defaultVersions = [],
  onRollbackToVersion
}: PromptVersionListProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const defaultVersionIds = useMemo(
    () => new Set(defaultVersions.map((v) => v.version_id)),
    [defaultVersions]
  )

  const filtered = useMemo(() => {
    if (!search.trim()) return versions
    const q = search.toLowerCase()
    return versions.filter(
      (v) =>
        v.version_name.toLowerCase().includes(q) ||
        v.comment.toLowerCase().includes(q) ||
        `v${v.version_number}`.includes(q)
    )
  }, [versions, search])

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle>{t('promptManagement.versions')}</CardTitle>
        {versions.length > 3 && (
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('promptManagement.searchVersions')}
            className="h-8 text-xs"
          />
        )}
      </CardHeader>
      <CardContent className="space-y-2 overflow-auto flex-1">
        {filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {search ? t('promptManagement.noVersionsMatch') : t('promptManagement.noVersions')}
          </div>
        ) : (
          filtered.map((version) => {
            const isActive = activeVersionId === version.version_id
            const isSelected = selectedVersionId === version.version_id
            const isDefault = defaultVersionIds.has(version.version_id)

            return (
              <button
                key={version.version_id}
                type="button"
                onClick={() => onSelectVersion(version.version_id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-blue-400 bg-blue-50/80 dark:bg-blue-950/20'
                    : 'hover:bg-muted/40'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium truncate">{version.version_name}</span>
                    {isDefault && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 shrink-0">
                        {t('promptManagement.seed')}
                      </span>
                    )}
                  </div>
                  {isActive ? (
                    <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white shrink-0">
                      {t('promptManagement.active')}
                    </span>
                  ) : onRollbackToVersion ? (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-blue-500 transition-colors"
                      title={t('promptManagement.rollbackToVersion', { name: version.version_name })}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRollbackToVersion(version)
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>v{version.version_number}</span>
                  <span>·</span>
                  <span>{formatDate(version.created_at)}</span>
                </div>
                {version.comment ? (
                  <div className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                    {version.comment}
                  </div>
                ) : null}
              </button>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
