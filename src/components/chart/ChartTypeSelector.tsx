import { Button } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import type { ChartType } from '@/types/encoding'
import { chartTypeOptions } from '@/utils/encodingToPlotly'

interface ChartTypeSelectorProps {
  value: ChartType
  onChange: (type: ChartType) => void
}

export function ChartTypeSelector({ value, onChange }: ChartTypeSelectorProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold text-muted">{t('chart.chartType')}</div>
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
    </div>
  )
}
