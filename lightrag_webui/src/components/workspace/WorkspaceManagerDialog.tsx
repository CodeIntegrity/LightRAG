import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  createWorkspace,
  getWorkspaceOperation,
  getWorkspaceStats,
  hardDeleteWorkspace,
  listWorkspaces,
  restoreWorkspace,
  softDeleteWorkspace,
  type WorkspaceOperationResponse,
  type WorkspaceRecord,
  type WorkspaceStatsResponse,
  type WorkspaceVisibility
} from '@/api/lightrag'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import { useSettingsStore } from '@/stores/settings'

function getCurrentRole(): string | null {
  const token = localStorage.getItem('LIGHTRAG-API-TOKEN')
  if (!token) {
    return null
  }
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

interface WorkspaceManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const operationStatusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  idle: 'outline',
  running: 'secondary',
  failed: 'destructive',
  completed: 'default'
}

export const getWorkspacesNeedingStats = (
  workspaces: WorkspaceRecord[],
  workspaceStats: Record<string, WorkspaceStatsResponse>
): string[] =>
  workspaces
    .filter((item) => item.status === 'ready')
    .map((item) => item.workspace)
    .filter((workspaceName) => workspaceStats[workspaceName] === undefined)

export const getWorkspacesNeedingOperationFetch = (
  workspaces: WorkspaceRecord[],
  workspaceOperations: Record<string, WorkspaceOperationResponse>
): string[] =>
  workspaces
    .filter((item) => item.status !== 'ready')
    .map((item) => item.workspace)
    .filter((workspaceName) => workspaceOperations[workspaceName] === undefined)

export const getRunningOperationWorkspaces = (
  workspaceOperations: Record<string, WorkspaceOperationResponse>
): string[] =>
  Object.entries(workspaceOperations)
    .filter(([, operation]) => operation?.state === 'running')
    .map(([workspaceName]) => workspaceName)

export default function WorkspaceManagerDialog({ open, onOpenChange }: WorkspaceManagerDialogProps) {
  const { t } = useTranslation()
  const currentWorkspace = useSettingsStore.use.currentWorkspace()
  const setCurrentWorkspace = useSettingsStore.use.setCurrentWorkspace()

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [workspace, setWorkspace] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<WorkspaceVisibility>('private')
  const [workspaceStats, setWorkspaceStats] = useState<Record<string, WorkspaceStatsResponse>>({})
  const [workspaceOperations, setWorkspaceOperations] = useState<Record<string, WorkspaceOperationResponse>>({})

  const role = useMemo(() => getCurrentRole(), [open])
  const isAdmin = role === 'admin'
  const isGuestMode = role === 'guest' || role === null
  const translateCapabilityLabel = (key: string) =>
    t(`workspaceManager.capabilityLabels.${key}`, { defaultValue: key })
  const translateCapabilityStatus = (status: string) =>
    t(`workspaceManager.capabilityStatus.${status}`, { defaultValue: status })
  const translateOperationStatus = (status: string) =>
    t(`workspaceManager.operationStatus.${status}`, { defaultValue: status })

  const refresh = async () => {
    setIsLoading(true)
    try {
      const response = await listWorkspaces(true)
      setWorkspaces(response.workspaces)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      void refresh()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const targets = getWorkspacesNeedingStats(workspaces, workspaceStats)
    if (targets.length === 0) {
      return
    }

    let cancelled = false

    const loadStats = async (workspaceName: string) => {
      try {
        const stats = await getWorkspaceStats(workspaceName)
        if (!cancelled) {
          setWorkspaceStats((current) => ({
            ...current,
            [workspaceName]: stats
          }))
        }
      } catch {
        // best-effort only
      }
    }

    targets.forEach((workspaceName) => {
      void loadStats(workspaceName)
    })

    return () => {
      cancelled = true
    }
  }, [open, workspaces, workspaceStats, currentWorkspace])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    const fetchTargets = getWorkspacesNeedingOperationFetch(workspaces, workspaceOperations)
    const runningWorkspaces = getRunningOperationWorkspaces(workspaceOperations)

    const syncOperation = async (workspaceName: string) => {
      try {
        const operation = await getWorkspaceOperation(workspaceName)
        if (!cancelled) {
          setWorkspaceOperations((current) => ({
            ...current,
            [workspaceName]: operation
          }))
        }
      } catch {
        // keep previous operation state
      }
    }

    fetchTargets.forEach((workspaceName) => {
      void syncOperation(workspaceName)
    })

    if (runningWorkspaces.length === 0) {
      return () => {
        cancelled = true
      }
    }

    const interval = setInterval(() => {
      void Promise.all(runningWorkspaces.map(syncOperation))
    }, 1500)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [open, workspaces, workspaceOperations])

  const handleCreate = async () => {
    try {
      await createWorkspace({
        workspace: workspace.trim(),
        display_name: displayName.trim() || workspace.trim(),
        description: description.trim(),
        visibility
      })
      toast.success(t('workspaceManager.createSuccess', 'Workspace created'))
      setWorkspace('')
      setDisplayName('')
      setDescription('')
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const handleSwitch = (record: WorkspaceRecord) => {
    setCurrentWorkspace(record.workspace)
    onOpenChange(false)
  }

  const handleSoftDelete = async (record: WorkspaceRecord) => {
    if (!window.confirm(t('workspaceManager.softDeleteConfirm', `Soft delete ${record.workspace}?`))) {
      return
    }
    try {
      await softDeleteWorkspace(record.workspace)
      if (record.workspace === currentWorkspace) {
        setCurrentWorkspace('')
      }
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const handleRestore = async (record: WorkspaceRecord) => {
    try {
      await restoreWorkspace(record.workspace)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const handleHardDelete = async (record: WorkspaceRecord) => {
    const confirmed = window.prompt(
      t('workspaceManager.hardDeletePrompt', `Type ${record.workspace} to confirm hard delete`)
    )
    if (confirmed !== record.workspace) {
      return
    }
    try {
      const response = await hardDeleteWorkspace(record.workspace)
      setWorkspaceOperations((current) => ({
        ...current,
        [record.workspace]: response.operation
      }))
      if (record.workspace === currentWorkspace) {
        setCurrentWorkspace('')
      }
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const readyWorkspaces = workspaces.filter((item) => item.status === 'ready')
  const deletedWorkspaces = workspaces.filter((item) => item.status !== 'ready')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('workspaceManager.title', 'Workspace Management')}</DialogTitle>
          <DialogDescription>
            {t('workspaceManager.description', 'Create, switch, and manage workspaces for the current server.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('workspaceManager.readyTitle', 'Workspaces')}</h3>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                {isLoading ? t('workspaceManager.loading', 'Loading...') : t('workspaceManager.refresh', 'Refresh')}
              </Button>
            </div>
            <div className="space-y-2">
              {readyWorkspaces.map((record) => (
                <div key={record.workspace} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{record.display_name || record.workspace}</div>
                      <div className="text-muted-foreground text-xs">{record.workspace || 'default'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={record.workspace === currentWorkspace ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => handleSwitch(record)}
                      >
                        {record.workspace === currentWorkspace
                          ? t('workspaceManager.current', 'Current')
                          : t('workspaceManager.switch', 'Switch')}
                      </Button>
                      {!isGuestMode && !record.is_protected && (
                        <Button variant="ghost" size="sm" onClick={() => void handleSoftDelete(record)}>
                          {t('workspaceManager.softDelete', 'Soft Delete')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {record.description && <div className="text-muted-foreground mt-2 text-xs">{record.description}</div>}
                  {workspaceStats[record.workspace] && (
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          <div className="text-muted-foreground">
                            {t('workspaceManager.stats.docs', {
                              count: workspaceStats[record.workspace].document_count ?? '-',
                              defaultValue: '{{count}} docs'
                            })}
                          </div>
                        </div>
                        <div className="bg-muted/40 rounded-md border px-3 py-2">
                          <div className="text-muted-foreground">
                            {t('workspaceManager.stats.promptVersions', {
                              count: workspaceStats[record.workspace].prompt_version_count ?? '-',
                              defaultValue: '{{count}} prompt versions'
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-md border border-dashed px-3 py-2">
                        <div className="text-muted-foreground mb-2 font-medium">
                          {t('workspaceManager.stats.capabilities', { defaultValue: 'Capabilities' })}
                        </div>
                      {Object.entries(workspaceStats[record.workspace].capabilities || {}).map(([key, value]) => (
                        <div key={`${record.workspace}-capability-${key}`} className="text-muted-foreground">
                          {translateCapabilityLabel(key)}: {translateCapabilityStatus(value)}
                        </div>
                      ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('workspaceManager.createTitle', 'Create Workspace')}</h3>
            <div className="space-y-2">
              <Input
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value)}
                placeholder={t('workspaceManager.workspacePlaceholder', 'workspace_name')}
              />
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t('workspaceManager.displayNamePlaceholder', 'Display name')}
              />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('workspaceManager.descriptionPlaceholder', 'Description')}
              />
              <select
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as WorkspaceVisibility)}
              >
                <option value="private">{t('workspaceManager.private', 'Private')}</option>
                <option value="public">{t('workspaceManager.public', 'Public')}</option>
              </select>
              <Button
                className="w-full"
                onClick={() => void handleCreate()}
                disabled={isGuestMode || workspace.trim().length === 0}
              >
                {t('workspaceManager.create', 'Create Workspace')}
              </Button>
            </div>

            <div className="space-y-2 pt-4">
              <h3 className="text-sm font-semibold">{t('workspaceManager.deletedTitle', 'Deleted / Pending')}</h3>
              {deletedWorkspaces.map((record) => (
                <div key={record.workspace} className="rounded-md border border-dashed p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{record.display_name || record.workspace}</div>
                      <div className="text-muted-foreground text-xs">
                        {(record.workspace || 'default')} · {record.status}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isGuestMode && record.status === 'soft_deleted' && (
                        <Button variant="outline" size="sm" onClick={() => void handleRestore(record)}>
                          {t('workspaceManager.restore', 'Restore')}
                        </Button>
                      )}
                      {isAdmin && !record.is_protected && (
                        <Button variant="destructive" size="sm" onClick={() => void handleHardDelete(record)}>
                          {t('workspaceManager.hardDelete', 'Hard Delete')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {workspaceOperations[record.workspace] && (
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {t('workspaceManager.operation.state', { defaultValue: 'State' })}:
                        </span>
                        <Badge
                          variant={
                            operationStatusVariantMap[workspaceOperations[record.workspace].state] || 'outline'
                          }
                        >
                          {translateOperationStatus(workspaceOperations[record.workspace].state)}
                        </Badge>
                      </div>
                      {workspaceOperations[record.workspace].progress && (
                        <div className="bg-muted/30 rounded-md border border-dashed px-3 py-2">
                          <div className="text-muted-foreground mb-2 font-medium">
                            {t('workspaceManager.operation.progress', { defaultValue: 'Progress' })}
                          </div>
                          {Object.entries(workspaceOperations[record.workspace].progress!).map(([key, value]) => (
                            <div key={`${record.workspace}-progress-${key}`} className="text-muted-foreground">
                              {key}: {String(value)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {record.delete_error && (
                    <div className="text-destructive mt-2 text-xs">{record.delete_error}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
