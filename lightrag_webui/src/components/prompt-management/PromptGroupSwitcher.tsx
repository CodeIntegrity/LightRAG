import Button from '@/components/ui/Button'
import { PromptConfigGroup } from '@/api/lightrag'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

type PromptGroupSwitcherProps = {
  value: PromptConfigGroup
  onChange: (group: PromptConfigGroup) => void
}

export default function PromptGroupSwitcher({ value, onChange }: PromptGroupSwitcherProps) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        variant="outline"
        className={cn(value === 'retrieval' && 'bg-blue-500 text-zinc-50 hover:bg-blue-600 hover:text-zinc-50')}
        onClick={() => onChange('retrieval')}
      >
        {t('promptManagement.groups.retrieval')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className={cn(value === 'indexing' && 'bg-blue-500 text-zinc-50 hover:bg-blue-600 hover:text-zinc-50')}
        onClick={() => onChange('indexing')}
      >
        {t('promptManagement.groups.indexing')}
      </Button>
    </div>
  )
}
