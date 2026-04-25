import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderKanbanIcon } from 'lucide-react'

import Button from '@/components/ui/Button'
import WorkspaceManagerDialog from '@/components/workspace/WorkspaceManagerDialog'
import { useSettingsStore } from '@/stores/settings'

export function resolveWorkspaceLabel(
  currentWorkspace: string,
  workspaceDisplayNames: Record<string, string>,
  t: (key: string, fallback?: string) => string
) {
  return (
    workspaceDisplayNames[currentWorkspace] ||
    currentWorkspace ||
    t('workspaceManager.defaultWorkspace', 'default')
  )
}

export default function WorkspaceSwitcher() {
  const { t } = useTranslation()
  const currentWorkspace = useSettingsStore.use.currentWorkspace()
  const workspaceDisplayNames = useSettingsStore.use.workspaceDisplayNames()
  const [open, setOpen] = useState(false)
  const currentWorkspaceLabel = resolveWorkspaceLabel(
    currentWorkspace,
    workspaceDisplayNames,
    t
  )

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-2"
        onClick={() => setOpen(true)}
      >
        <FolderKanbanIcon className="size-4" />
        <span>{currentWorkspaceLabel}</span>
      </Button>
      {open ? <WorkspaceManagerDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}
