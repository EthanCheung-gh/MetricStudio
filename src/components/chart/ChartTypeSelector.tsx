import { useState } from 'react'
import { Button } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import type { ChartType } from '@/types/encoding'
import { chartTypeOptions } from '@/utils/chartConstants'
import { chartTypeLabel } from '@/utils/chartTypeLabel'
import { useCustomChartStore } from '@/stores/customChartStore'
import { useUIStore } from '@/stores/uiStore'
import { CustomChartsDialog } from '@/components/chart/CustomChartsDialog'

interface ChartTypeSelectorProps {
  value: ChartType
  onChange: (type: ChartType) => void
}

export function ChartTypeSelector({ value, onChange }: ChartTypeSelectorProps) {
  const { t } = useTranslation()
  const language = useUIStore((s) => s.language)
  const customCharts = useCustomChartStore((s) => s.items)
  const [manageOpen, setManageOpen] = useState(false)

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-muted">{t('chart.chartType')}</div>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            className="h-5 w-5 min-w-0"
            aria-label={t('chart.custom.manage')}
            onPress={() => setManageOpen(true)}
          >
            <SlidersHorizontal className="h-3 w-3" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {chartTypeOptions.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={value === opt.value ? 'solid' : 'flat'}
              color={value === opt.value ? 'primary' : 'default'}
              onPress={() => onChange(opt.value)}
              className="text-xs"
            >
              {t(`chart.type.${opt.value}`)}
            </Button>
          ))}
        </div>
        {customCharts.length > 0 && (
          <div className="mt-1 flex flex-col gap-1 border-t border-border pt-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {t('chart.custom.group')}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {customCharts.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={value === item.id ? 'solid' : 'flat'}
                  color={value === item.id ? 'primary' : 'default'}
                  onPress={() => onChange(item.id)}
                  className="text-xs"
                >
                  {chartTypeLabel(item.id, language, t)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
      <CustomChartsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  )
}
