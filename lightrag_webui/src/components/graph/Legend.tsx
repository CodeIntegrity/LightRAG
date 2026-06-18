import React from 'react'
import { useTranslation } from 'react-i18next'
import { useGraphStore } from '@/stores/graph'
import { useSettingsStore } from '@/stores/settings'
import { Card } from '@/components/ui/Card'
import { ScrollArea } from '@/components/ui/ScrollArea'

interface LegendProps {
  className?: string
}

const Legend: React.FC<LegendProps> = ({ className }) => {
  const { t } = useTranslation()
  const colorScheme = useSettingsStore.use.graphColorScheme()
  const typeColorMap = useGraphStore.use.typeColorMap()
  const communityColorMap = useGraphStore.use.communityColorMap()

  // 图例数据源跟随当前着色模式：按类型 → 类型色表；按社区 → 社区色表
  const activeMap = colorScheme === 'community' ? communityColorMap : typeColorMap

  if (!activeMap || activeMap.size === 0) {
    return null
  }

  const title =
    colorScheme === 'community' ? t('graphPanel.legendByCommunity') : t('graphPanel.legend')

  return (
    <Card className={`p-2 max-w-xs ${className}`}>
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      <ScrollArea className="max-h-80">
        <div className="flex flex-col gap-1">
          {Array.from(activeMap.entries()).map(([label, color]) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs truncate" title={label}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  )
}

export default Legend
