import { PromptVersionRecord } from '@/api/lightrag'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/Select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import {
  getCachedRetrievalPromptRegistry,
  warmRetrievalPromptVersion
} from '@/utils/retrievalPromptCache'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type RetrievalPromptVersionSelectorProps = {
  enabled: boolean
  value: string
  onChange: (value: string) => void
}

export type RetrievalPromptSelectionMode = 'active' | 'saved' | 'custom'

export const getRetrievalPromptSelectionMode = (value: string): RetrievalPromptSelectionMode => {
  if (value === 'custom') {
    return 'custom'
  }
  if (value === 'active') {
    return 'active'
  }
  return 'saved'
}

export const getSavedRetrievalPromptVersionId = (
  versions: PromptVersionRecord[],
  currentValue: string,
  activeVersionId: string | null
): string | null => {
  if (versions.length === 0) {
    return null
  }

  if (versions.some((version) => version.version_id === currentValue)) {
    return currentValue
  }

  if (activeVersionId && versions.some((version) => version.version_id === activeVersionId)) {
    return activeVersionId
  }

  return versions[0].version_id
}

export default function RetrievalPromptVersionSelector({
  enabled,
  value,
  onChange
}: RetrievalPromptVersionSelectorProps) {
  const { t } = useTranslation()
  const [versions, setVersions] = useState<PromptVersionRecord[]>([])
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const selectionMode = getRetrievalPromptSelectionMode(value)
  const selectedSavedVersionId =
    selectionMode === 'saved' && versions.some((version) => version.version_id === value)
      ? value
      : undefined

  useEffect(() => {
    if (!enabled) {
      setVersions([])
      setActiveVersionId(null)
      return
    }

    getCachedRetrievalPromptRegistry()
      .then((registry) => {
        setVersions(registry.versions)
        setActiveVersionId(registry.active_version_id)

        if (getRetrievalPromptSelectionMode(value) !== 'saved') {
          return
        }

        const nextSavedVersionId = getSavedRetrievalPromptVersionId(
          registry.versions,
          value,
          registry.active_version_id
        )
        if (nextSavedVersionId === null) {
          onChange('active')
          return
        }
        if (nextSavedVersionId !== value) {
          onChange(nextSavedVersionId)
        }
      })
      .catch(() => {
        setVersions([])
        setActiveVersionId(null)
      })
  }, [enabled, onChange, value])

  useEffect(() => {
    if (!enabled || selectionMode !== 'saved' || !value) {
      return
    }

    warmRetrievalPromptVersion(value).catch(() => undefined)
  }, [enabled, selectionMode, value])

  const handleModeChange = (nextMode: string) => {
    if (nextMode === 'saved') {
      const nextSavedVersionId = getSavedRetrievalPromptVersionId(versions, value, activeVersionId)
      if (nextSavedVersionId) {
        onChange(nextSavedVersionId)
      }
      return
    }

    onChange(nextMode)
  }

  return (
    <div className="space-y-2">
      <Tabs value={selectionMode} onValueChange={handleModeChange}>
        <TabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="active" className="px-2 text-xs">
            {t('retrievePanel.querySettings.promptVersionModes.active')}
          </TabsTrigger>
          <TabsTrigger
            value="saved"
            className="px-2 text-xs"
            disabled={!enabled || versions.length === 0}
          >
            {t('retrievePanel.querySettings.promptVersionModes.saved')}
          </TabsTrigger>
          <TabsTrigger value="custom" className="px-2 text-xs" disabled={!enabled}>
            {t('retrievePanel.querySettings.promptVersionModes.custom')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {selectionMode === 'saved' ? (
        <Select
          value={selectedSavedVersionId}
          onValueChange={onChange}
          disabled={!enabled || versions.length === 0}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder={t('retrievePanel.querySettings.savedVersionPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {versions.map((version) => (
              <SelectItem key={version.version_id} value={version.version_id}>
                {version.version_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}
