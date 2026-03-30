import { type FormEvent, useEffect, useMemo, useState } from 'react'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
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
import { useBackendState } from '@/stores/state'
import { getJwtRole } from '@/utils/jwt'

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

export const shouldRefreshWorkspacesAfterOperationError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'response' in error &&
  typeof error.response === 'object' &&
  error.response !== null &&
  'status' in error.response &&
  error.response.status === 404

export const shouldDisableSoftDelete = (
  workspaceName: string,
  currentWorkspace: string
): boolean => workspaceName === currentWorkspace

export default function WorkspaceManagerDialog({ open, onOpenChange }: WorkspaceManagerDialogProps) {
  const { t } = useTranslation()
  const currentWorkspace = useSettingsStore.use.currentWorkspace()
  const setCurrentWorkspace = useSettingsStore.use.setCurrentWorkspace()
  const setWorkspaceDisplayNames = useSettingsStore.use.setWorkspaceDisplayNames()
  const workspaceCreateAllowed = useBackendState.use.workspaceCreateAllowed()

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [workspace, setWorkspace] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<WorkspaceVisibility>('private')
  const [workspaceStats, setWorkspaceStats] = useState<Record<string, WorkspaceStatsResponse>>({})
  const [workspaceOperations, setWorkspaceOperations] = useState<Record<string, WorkspaceOperationResponse>>({})

  const role = useMemo(() => getJwtRole(localStorage.getItem('LIGHTRAG-API-TOKEN')), [open])
  const isAdmin = role === 'admin'
  const isGuestMode = role === 'guest' || role === null
  const translateOperationStatus = (status: string) =>
    t(`workspaceManager.operationStatus.${status}`, { defaultValue: status })

  const refresh = async () => {
    setIsLoading(true)
    try {
      const response = await listWorkspaces(true)
      setWorkspaces(response.workspaces)
      setWorkspaceDisplayNames(
        Object.fromEntries(
          response.workspaces.map((record) => [record.workspace, record.display_name || record.workspace])
        )
      )
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
    const runningWorkspaces = getRunningOperationWorkspaces(workspaceOperations).filter((workspaceName) =>
      workspaces.some((item) => item.workspace === workspaceName)
    )

    const syncOperation = async (workspaceName: string) => {
      try {
        const operation = await getWorkspaceOperation(workspaceName)
        if (!cancelled) {
          setWorkspaceOperations((current) => ({
            ...current,
            [workspaceName]: operation
          }))
        }
      } catch (error) {
        if (!cancelled && shouldRefreshWorkspacesAfterOperationError(error)) {
          await refresh()
        }
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

  const handleCreate = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (workspace.trim().length === 0 || !workspaceCreateAllowed) {
      return
    }

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
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes('/workspaces') &&
        message.includes('Workspace creation is not allowed for this session')
      ) {
        void useBackendState.getState().check()
      }
      toast.error(message)
    }
  }

  const handleSwitch = (record: WorkspaceRecord) => {
    setCurrentWorkspace(record.workspace)
    onOpenChange(false)
    window.location.reload()
  }

  const handleSoftDelete = async (record: WorkspaceRecord) => {
    if (shouldDisableSoftDelete(record.workspace, currentWorkspace)) {
      return
    }
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
      t('workspaceManager.hardDeletePrompt', {
        workspace: record.workspace,
        defaultValue: `Type ${record.workspace} to confirm hard delete`
      })
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
  const currentWorkspaceRecord = workspaces.find((item) => item.workspace === currentWorkspace)
  const currentWorkspaceLabel =
    currentWorkspaceRecord?.display_name || currentWorkspace || t('workspaceManager.summary.none', 'Not selected')
  const canCreateWorkspace = workspace.trim().length > 0 && workspaceCreateAllowed

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5">
          <DialogTitle>{t('workspaceManager.title', 'Workspace Management')}</DialogTitle>
          <DialogDescription>
            {t('workspaceManager.description', 'Create, switch, and manage workspaces for the current server.')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-4">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('workspaceManager.summary.total', 'Total workspaces')}
              </div>
              <div className="mt-3 text-3xl font-semibold">{workspaces.length}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t('workspaceManager.readyTitle', 'Workspaces')}: {readyWorkspaces.length}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/80 p-4">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('workspaceManager.summary.current', 'Active workspace')}
              </div>
              <div className="mt-3 truncate text-lg font-semibold">{currentWorkspaceLabel}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {currentWorkspace || t('workspaceManager.defaultWorkspace', 'default')}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('workspaceManager.summary.pending', 'Pending changes')}
              </div>
              <div className="mt-3 text-3xl font-semibold">{deletedWorkspaces.length}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t('workspaceManager.deletedTitle', 'Deleted / Pending')}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
            <section className="space-y-6">
              <Card className="overflow-hidden border-emerald-200/70 shadow-sm">
                <CardHeader className="bg-emerald-50/50 pb-4">
                  <CardTitle className="text-base">{t('workspaceManager.createTitle', 'Create Workspace')}</CardTitle>
                  <CardDescription>
                    {t(
                      'workspaceManager.createDescription',
                      'Set a stable workspace key, a friendly display name, and the visibility you want to share.'
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  <form className="space-y-4" onSubmit={(event) => void handleCreate(event)}>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor="workspace-name">
                        {t('workspaceManager.workspaceLabel', 'Workspace key')}
                      </label>
                      <Input
                        id="workspace-name"
                        value={workspace}
                        onChange={(event) => setWorkspace(event.target.value)}
                        placeholder={t('workspaceManager.workspacePlaceholder', 'workspace_name')}
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor="workspace-display-name">
                        {t('workspaceManager.displayNameLabel', 'Display name')}
                      </label>
                      <Input
                        id="workspace-display-name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder={t('workspaceManager.displayNamePlaceholder', 'Display name')}
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor="workspace-description">
                        {t('workspaceManager.descriptionLabel', 'Description')}
                      </label>
                      <textarea
                        id="workspace-description"
                        className="border-input placeholder:text-muted-foreground focus-visible:ring-ring min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={t('workspaceManager.descriptionPlaceholder', 'Description')}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor="workspace-visibility">
                        {t('workspaceManager.visibilityLabel', 'Visibility')}
                      </label>
                      <select
                        id="workspace-visibility"
                        className="border-input bg-background h-10 w-full rounded-md border px-3 py-2 text-sm"
                        value={visibility}
                        onChange={(event) => setVisibility(event.target.value as WorkspaceVisibility)}
                      >
                        <option value="private">{t('workspaceManager.private', 'Private')}</option>
                        <option value="public">{t('workspaceManager.public', 'Public')}</option>
                      </select>
                    </div>
                    {isGuestMode && (
                      <div className="text-muted-foreground bg-muted/40 rounded-md border border-dashed px-3 py-2 text-xs">
                        {workspaceCreateAllowed
                          ? t(
                              'workspaceManager.guestCreateHint',
                              'This workspace will be created as guest.'
                            )
                          : t('workspaceManager.loginRequiredHint', 'Log in to create workspaces.')}
                      </div>
                    )}
                    <Button className="h-10 w-full" type="submit" disabled={!canCreateWorkspace}>
                      {t('workspaceManager.create', 'Create Workspace')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-6">
              <Card className="overflow-hidden shadow-sm">
                <CardHeader className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{t('workspaceManager.readyTitle', 'Workspaces')}</CardTitle>
                    <CardDescription>
                      {t(
                        'workspaceManager.readyDescription',
                        'Switch between active workspaces and review each workspace summary at a glance.'
                      )}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void refresh()}>
                    {isLoading ? t('workspaceManager.loading', 'Loading...') : t('workspaceManager.refresh', 'Refresh')}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                  {readyWorkspaces.length === 0 && (
                    <div className="text-muted-foreground bg-muted/30 rounded-lg border border-dashed px-4 py-6 text-sm">
                      {t('workspaceManager.emptyReady', 'No ready workspaces yet.')}
                    </div>
                  )}
                  {readyWorkspaces.length > 0 && (
                    <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                      {readyWorkspaces.map((record) => (
                        <div
                          key={record.workspace}
                          className={`rounded-xl border p-4 shadow-sm transition-colors ${
                            record.workspace === currentWorkspace
                              ? 'border-emerald-300/70 bg-emerald-50/40'
                              : 'bg-background'
                          }`}
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 space-y-3">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-base font-semibold">
                                    {record.display_name || record.workspace}
                                  </div>
                                  {record.workspace === currentWorkspace && (
                                    <Badge variant="secondary">{t('workspaceManager.current', 'Current')}</Badge>
                                  )}
                                  <Badge variant="outline">
                                    {record.visibility === 'public'
                                      ? t('workspaceManager.public', 'Public')
                                      : t('workspaceManager.private', 'Private')}
                                  </Badge>
                                  {record.is_protected && (
                                    <Badge variant="outline">{t('workspaceManager.defaultWorkspace', 'default')}</Badge>
                                  )}
                                </div>
                                <div className="text-muted-foreground font-mono text-xs">
                                  {record.workspace || t('workspaceManager.defaultWorkspace', 'default')}
                                </div>
                              </div>
                              {record.description && (
                                <div className="text-muted-foreground text-sm">{record.description}</div>
                              )}
                              {workspaceStats[record.workspace] && (
                                <div className="space-y-3 text-xs">
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
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
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
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={shouldDisableSoftDelete(record.workspace, currentWorkspace)}
                                  tooltip={
                                    shouldDisableSoftDelete(record.workspace, currentWorkspace)
                                      ? t('workspaceManager.softDeleteDisabledCurrent', {
                                          defaultValue: 'Switch to another workspace before soft deleting it.'
                                        })
                                      : undefined
                                  }
                                  onClick={() => void handleSoftDelete(record)}
                                >
                                  {t('workspaceManager.softDelete', 'Soft Delete')}
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="overflow-hidden border-dashed shadow-sm">
                <CardHeader className="border-b border-border/60 pb-4">
                  <CardTitle className="text-base">{t('workspaceManager.deletedTitle', 'Deleted / Pending')}</CardTitle>
                  <CardDescription>
                    {t(
                      'workspaceManager.deletedDescription',
                      'Track deleted workspaces, restores, and any hard-delete jobs that are still running.'
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                  {deletedWorkspaces.length === 0 && (
                    <div className="text-muted-foreground bg-muted/30 rounded-lg border border-dashed px-4 py-6 text-sm">
                      {t('workspaceManager.emptyDeleted', 'No deleted or pending workspaces.')}
                    </div>
                  )}
                  {deletedWorkspaces.map((record) => (
                    <div key={record.workspace} className="rounded-xl border border-dashed p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="font-semibold">{record.display_name || record.workspace}</div>
                          <div className="text-muted-foreground font-mono text-xs">
                            {(record.workspace || t('workspaceManager.defaultWorkspace', 'default'))} · {record.status}
                          </div>
                          {record.description && (
                            <div className="text-muted-foreground text-sm">{record.description}</div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          {!isGuestMode && record.status === 'soft_deleted' && (
                            <Button variant="outline" size="sm" onClick={() => void handleRestore(record)}>
                              {t('workspaceManager.restore', 'Restore')}
                            </Button>
                          )}
                          {isAdmin && !record.is_protected && ['soft_deleted', 'delete_failed'].includes(record.status) && (
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
                </CardContent>
              </Card>
            </section>
          </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
