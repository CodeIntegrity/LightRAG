import Button from '@/components/ui/Button'
import { SiteInfo, webuiPrefix } from '@/lib/constants'
import AppSettings from '@/components/AppSettings'
import WorkspaceSwitcher from '@/components/workspace/WorkspaceSwitcher'
import { TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore, useBackendState } from '@/stores/state'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { navigationService } from '@/services/navigation'
import { LogInIcon, LogOutIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import { resolveVisibleTabsForSession } from '@/lib/guestFeatures'

interface NavigationTabProps {
  value: string
  currentTab: string
  children: React.ReactNode
}

function NavigationTab({ value, currentTab, children }: NavigationTabProps) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'cursor-pointer px-2 py-1 transition-all',
        currentTab === value ? '!bg-blue-500 !text-zinc-50' : 'hover:bg-background/60'
      )}
    >
      {children}
    </TabsTrigger>
  )
}

function TabsNavigation() {
  const currentTab = useSettingsStore.use.currentTab()
  const guestVisibleTabs = useBackendState.use.guestVisibleTabs()
  const isGuestMode = useAuthStore((state) => state.isGuestMode)
  const { t } = useTranslation()
  const visibleTabs = resolveVisibleTabsForSession(isGuestMode, guestVisibleTabs)

  return (
    <div className="flex h-8 self-center">
      <TabsList className="h-full gap-2">
        {visibleTabs.includes('documents') && (
          <NavigationTab value="documents" currentTab={currentTab}>
            {t('header.documents')}
          </NavigationTab>
        )}
        {visibleTabs.includes('knowledge-graph') && (
          <NavigationTab value="knowledge-graph" currentTab={currentTab}>
            {t('header.knowledgeGraph')}
          </NavigationTab>
        )}
        {visibleTabs.includes('prompt-management') && (
          <NavigationTab value="prompt-management" currentTab={currentTab}>
            {t('header.promptManagement')}
          </NavigationTab>
        )}
        {visibleTabs.includes('retrieval') && (
          <NavigationTab value="retrieval" currentTab={currentTab}>
            {t('header.retrieval')}
          </NavigationTab>
        )}
        {visibleTabs.includes('api') && (
          <NavigationTab value="api" currentTab={currentTab}>
            {t('header.api')}
          </NavigationTab>
        )}
      </TabsList>
    </div>
  )
}

export default function SiteHeader() {
  const { t } = useTranslation()
  const { isGuestMode, username, webuiTitle, webuiDescription } = useAuthStore()

  const handleAuthAction = () => {
    navigationService.navigateToLogin()
  }

  const authActionLabel = isGuestMode ? t('header.login', 'Login') : t('header.logout')
  const authActionTooltip = isGuestMode
    ? t('header.login', 'Login')
    : username
      ? `${t('header.logout')} (${username})`
      : t('header.logout')

  return (
    <header className="border-border/40 bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 flex h-10 w-full border-b px-4 backdrop-blur">
      <div className="min-w-[200px] w-auto flex items-center">
        <a href={webuiPrefix} className="flex items-center gap-2">
          <img src="/webui/ajrlogo.png" alt="Logo" className="h-6 w-auto object-contain" />
          <span className="font-bold md:inline-block">{SiteInfo.name}</span>
        </a>
        {webuiTitle && (
          <div className="flex items-center">
            <span className="mx-1 text-xs text-gray-500 dark:text-gray-400">|</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-medium text-sm cursor-default">
                    {webuiTitle}
                  </span>
                </TooltipTrigger>
                {webuiDescription && (
                  <TooltipContent side="bottom">
                    {webuiDescription}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      <div className="flex h-10 flex-1 items-center justify-center">
        <div className="mr-3">
          <WorkspaceSwitcher />
        </div>
        <TabsNavigation />
        {isGuestMode && (
          <div className="ml-2 self-center px-2 py-1 text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 rounded-md">
            {t('login.guestMode', 'Guest Mode')}
          </div>
        )}
      </div>

      <nav className="w-[200px] flex items-center justify-end">
        <div className="flex items-center gap-2">
          <AppSettings />
          <Button
            variant="ghost"
            size="sm"
            side="bottom"
            tooltip={authActionTooltip}
            onClick={handleAuthAction}
          >
            {isGuestMode ? (
              <LogInIcon className="size-4" aria-hidden="true" />
            ) : (
              <LogOutIcon className="size-4" aria-hidden="true" />
            )}
            <span>{authActionLabel}</span>
          </Button>
        </div>
      </nav>
    </header>
  )
}
