import {
  activatePromptConfigVersion,
  createPromptConfigVersion,
  deletePromptConfigVersion,
  diffPromptConfigVersion,
  getPromptConfigVersions,
  initializePromptConfig,
  PromptConfigGroup,
  PromptVersionCreateRequest,
  PromptVersionUpdateRequest,
  PromptVersionRecord,
  rebuildDocumentsFromIndexingVersion,
  updatePromptConfigVersion
} from '@/api/lightrag'
import PromptGroupSwitcher from '@/components/prompt-management/PromptGroupSwitcher'
import PromptVersionDiffDialog from '@/components/prompt-management/PromptVersionDiffDialog'
import PromptVersionEditor from '@/components/prompt-management/PromptVersionEditor'
import PromptVersionList from '@/components/prompt-management/PromptVersionList'
import EmptyCard from '@/components/ui/EmptyCard'
import Button from '@/components/ui/Button'
import { useSettingsStore } from '@/stores/settings'
import { getPreferredPromptVersionId } from '@/utils/promptVersioning'
import { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Download, Upload } from 'lucide-react'

export default function PromptManagement() {
  const { t } = useTranslation()
  const language = useSettingsStore.use.language()
  const currentWorkspace = useSettingsStore.use.currentWorkspace()
  const workspaceDisplayNames = useSettingsStore.use.workspaceDisplayNames()
  const groupType = useSettingsStore.use.promptManagementGroup()
  const selectedVersionId = useSettingsStore.use.promptManagementSelectedVersionId()
  const setGroupType = useSettingsStore.use.setPromptManagementGroup()
  const setSelectedVersionId = useSettingsStore.use.setPromptManagementSelectedVersionId()

  const [registry, setRegistry] = useState<{ active_version_id: string | null; versions: PromptVersionRecord[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffData, setDiffData] = useState<{ changes: Record<string, { before: unknown; after: unknown }> } | null>(null)
  const selectionModeRef = useRef<'automatic' | 'manual'>('automatic')
  const locale = language.startsWith('zh') ? 'zh' : 'en'

  const loadVersions = useCallback(async () => {
    setLoading(true)
    try {
      await initializePromptConfig(locale)
      const nextRegistry = await getPromptConfigVersions(groupType)
      setRegistry(nextRegistry)
      const nextSelectedVersionId = getPreferredPromptVersionId({
        versions: nextRegistry.versions,
        activeVersionId: nextRegistry.active_version_id,
        selectedVersionId,
        groupType,
        locale,
        selectionMode: selectionModeRef.current
      })
      setSelectedVersionId(nextSelectedVersionId)
    } catch (error) {
      toast.error(String(error))
    } finally {
      selectionModeRef.current = 'automatic'
      setLoading(false)
    }
  }, [groupType, locale, selectedVersionId, setSelectedVersionId])

  useEffect(() => {
    loadVersions()
  }, [loadVersions])

  const versions = registry?.versions || []
  const activeVersionId = registry?.active_version_id || null
  const selectedVersion = versions.find((version) => version.version_id === selectedVersionId) || null
  const seedVersions = useMemo(
    () => versions.filter((v) => v.version_name.startsWith(`${groupType}-`) && v.version_name.endsWith('-default')),
    [versions, groupType]
  )
  const versionsById = useMemo(
    () => Object.fromEntries(versions.map((version) => [version.version_id, version])),
    [versions]
  )

  const handleSaveCurrentVersion = async (
    version: PromptVersionRecord,
    payload: PromptVersionUpdateRequest
  ) => {
    const savedVersion = await updatePromptConfigVersion(groupType, version.version_id, payload)
    toast.success(t('promptManagement.saved', { name: savedVersion.version_name }))
    await loadVersions()
    selectionModeRef.current = 'manual'
    setSelectedVersionId(savedVersion.version_id)
  }

  const handleSaveAsNewVersion = async (payload: PromptVersionCreateRequest) => {
    const savedVersion = await createPromptConfigVersion(groupType, payload)
    toast.success(t('promptManagement.saved', { name: savedVersion.version_name }))
    await loadVersions()
    selectionModeRef.current = 'manual'
    setSelectedVersionId(savedVersion.version_id)
  }

  const handleActivateVersion = async (version: PromptVersionRecord) => {
    if (
      groupType === 'indexing' &&
      !window.confirm(t('promptManagement.indexingActivateWarning'))
    ) {
      return
    }

    const response = await activatePromptConfigVersion(groupType, version.version_id)
    if (response.warning) {
      toast.warning(
        groupType === 'indexing'
          ? t('promptManagement.indexingActivateWarning')
          : response.warning
      )
    }

    toast.success(t('promptManagement.activated', { name: version.version_name }), {
      ...(groupType === 'indexing' ? {
        action: {
          label: t('promptManagement.rebuildFromSelectedVersion'),
          onClick: async () => {
            await handleRebuildFromVersion(version)
          }
        },
        duration: 10000
      } : {})
    })

    await loadVersions()
    selectionModeRef.current = 'manual'
    setSelectedVersionId(version.version_id)
  }

  const handleDeleteVersion = async (version: PromptVersionRecord) => {
    if (!window.confirm(t('promptManagement.deleteConfirm', { name: version.version_name }))) {
      return
    }
    await deletePromptConfigVersion(groupType, version.version_id)
    toast.success(t('promptManagement.deletedMessage', { name: version.version_name }))
    await loadVersions()
  }

  const handleShowDiff = async (version: PromptVersionRecord) => {
    const nextDiff = await diffPromptConfigVersion(
      groupType,
      version.version_id,
      activeVersionId && activeVersionId !== version.version_id ? activeVersionId : undefined
    )
    setDiffData(nextDiff)
    setDiffOpen(true)
  }

  const handleRebuildFromVersion = async (version: PromptVersionRecord) => {
    if (
      !window.confirm(t('promptManagement.rebuildConfirm', { name: version.version_name }))
    ) {
      return
    }

    const response = await rebuildDocumentsFromIndexingVersion(version.version_id)
    if (response.status === 'busy') {
      toast.warning(t('promptManagement.rebuildBusy'))
      return
    }
    toast.success(t('promptManagement.rebuildStarted', { name: version.version_name }))
    await loadVersions()
    selectionModeRef.current = 'manual'
    setSelectedVersionId(version.version_id)
  }

  const handleExportVersions = useCallback(() => {
    if (versions.length === 0) return
    const exportData = {
      group_type: groupType,
      exported_at: new Date().toISOString(),
      version_count: versions.length,
      versions: versions.map((v) => ({
        version_name: v.version_name,
        comment: v.comment,
        source_version_id: v.source_version_id,
        payload: v.payload
      }))
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lightrag-${groupType}-prompts-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('promptManagement.exportedVersions', { count: versions.length }))
  }, [versions, groupType, t])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportVersions = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.versions || !Array.isArray(data.versions)) {
        toast.error(t('promptManagement.importInvalidFormat'))
        return
      }

      let imported = 0
      for (const version of data.versions) {
        if (!version.version_name || !version.payload) continue
        await createPromptConfigVersion(groupType, {
          version_name: version.version_name,
          comment: version.comment || '',
          payload: version.payload,
          source_version_id: version.source_version_id || undefined
        })
        imported++
      }

      toast.success(t('promptManagement.importedVersions', { count: imported }))
      await loadVersions()
    } catch {
      toast.error(t('promptManagement.importFailed'))
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [groupType, t, loadVersions])

  const workspaceLabel =
    workspaceDisplayNames[currentWorkspace] ||
    currentWorkspace ||
    t('workspaceManager.defaultWorkspace', 'default')

  if (!loading && versions.length === 0) {
    return (
      <EmptyCard
        className="h-full"
        title={t('promptManagement.emptyTitle')}
        description={t('promptManagement.emptyDescription')}
        action={
          <Button
            type="button"
            onClick={async () => {
              await initializePromptConfig(locale)
              await loadVersions()
            }}
          >
            {t('promptManagement.initializeSeedVersions')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid h-full grid-cols-[320px_1fr] gap-4 p-4">
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Workspace</span>
          <span className="text-xs font-medium">{workspaceLabel}</span>
        </div>
        <PromptGroupSwitcher
          value={groupType}
          onChange={(nextGroup: PromptConfigGroup) => {
            selectionModeRef.current = 'automatic'
            setGroupType(nextGroup)
            setSelectedVersionId(null)
          }}
        />
        {versions.length > 0 && (
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleExportVersions}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('promptManagement.export')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              {t('promptManagement.import')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportVersions}
            />
          </div>
        )}
        <PromptVersionList
          versions={versions}
          activeVersionId={activeVersionId}
          selectedVersionId={selectedVersionId}
          onSelectVersion={(versionId) => {
            selectionModeRef.current = 'manual'
            setSelectedVersionId(versionId)
          }}
          defaultVersions={seedVersions}
          onRollbackToVersion={handleActivateVersion}
        />
      </div>

      <PromptVersionEditor
        groupType={groupType}
        version={selectedVersion}
        versionsById={versionsById}
        activeVersionId={activeVersionId}
        onSaveCurrentVersion={handleSaveCurrentVersion}
        onSaveAsNewVersion={handleSaveAsNewVersion}
        onActivateVersion={handleActivateVersion}
        onDeleteVersion={handleDeleteVersion}
        onShowDiff={handleShowDiff}
        onRebuildFromVersion={handleRebuildFromVersion}
      />

      <PromptVersionDiffDialog open={diffOpen} onOpenChange={setDiffOpen} diffData={diffData} />
    </div>
  )
}
