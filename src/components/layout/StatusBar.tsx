import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@heroui/react'
import { Activity, Cpu, PackageCheck, PackageX, Rows3 } from 'lucide-react'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { api, type DepsReport } from '@/api/client'
import { fmt } from '@/utils/format'

export function StatusBar() {
  const { t } = useTranslation();
  const activeId = useDataStore((s) => s.activeDataFrameId)
  const dataFrames = useDataStore((s) => s.dataFrames)
  const preview = useDataStore((s) => s.preview)
  const backendConnected = useUIStore((s) => s.backendConnected)
  const backendMessage = useUIStore((s) => s.backendStatusMessage)
  const [deps, setDeps] = useState<DepsReport | null>(null)

  // Dependency check once per backend (re)connection (spec §11)
  useEffect(() => {
    if (!backendConnected) return
    api.checkDeps().then(setDeps).catch(() => setDeps(null))
  }, [backendConnected])

  const active = dataFrames.find((df) => df.id === activeId)
  // Live row/col counts come from the current preview (updated after every
  // transform); the static DataFrameMeta is a fallback before preview loads.
  const rows = preview?.totalRows ?? active?.rows
  const cols = preview?.totalCols ?? active?.cols

  const depsTooltip = deps
    ? [
        `Python ${deps.python}${deps.pythonOk ? '' : ' (requires 3.10+)'}`,
        ...Object.entries(deps.packages).map(
          ([name, info]) => `${name}: ${info.available ? info.version : 'MISSING'}`,
        ),
      ].join('\n')
    : ''

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-surface px-3 text-xs text-muted">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Activity className="h-3 w-3" />
          <span className={backendConnected ? 'text-success' : 'text-danger'}>
            {backendConnected ? t('status.backendOnline') : backendMessage}
          </span>
        </span>
        {deps && (
          <Tooltip content={<span className="whitespace-pre">{depsTooltip}</span>} placement="top">
            <span className="flex items-center gap-1 cursor-default">
              {deps.ok && deps.missingOptional.length === 0 ? (
                <>
                  <PackageCheck className="h-3 w-3 text-success" />
                  <span className="text-success">依赖正常</span>
                </>
              ) : (
                <>
                  <PackageX className={`h-3 w-3 ${deps.ok ? 'text-warning' : 'text-danger'}`} />
                  <span className={deps.ok ? 'text-warning' : 'text-danger'}>
                    {deps.ok
                      ? `Optional missing: ${deps.missingOptional.join(', ')}`
                      : `Missing: ${[...(deps.pythonOk ? [] : ['python>=3.10']), ...deps.missingRequired].join(', ')}`}
                  </span>
                </>
              )}
            </span>
          </Tooltip>
        )}
        {active && (
          <>
            <span className="flex items-center gap-1">
              <Rows3 className="h-3 w-3" />
              {fmt(rows)} {t('status.rows')} × {fmt(cols)} {t('status.cols')}
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {t('status.engine')}: {active.engine ?? 'pandas'}
            </span>
          </>
        )}
      </div>
      <div>MetricStudio v0.1.0</div>
    </div>
  )
}
