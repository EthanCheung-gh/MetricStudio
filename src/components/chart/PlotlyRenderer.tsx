import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { Button } from '@heroui/react'
import type { PlotlyFigure } from '@/types/plotly'
import { resolvedTheme } from '@/hooks/useSystemTheme'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { applyPlotlyUserStyle, mergePlotlyLayout } from '@/utils/plotlyLayout'

declare const Plotly: {
  react: (el: HTMLElement, data: unknown[], layout: unknown, config?: unknown) => Promise<unknown> | void
  Plots: { resize: (el: HTMLElement) => void; redraw: (el: HTMLElement) => void }
  purge: (el: HTMLElement) => void
  toImage: (el: HTMLElement, opts: { format: string; height: number; width: number }) => Promise<string>
}

export interface PlotlySelection {
  xRange: [number | string, number | string] | null
  yRange: [number | string, number | string] | null
}

interface PlotlyRendererProps {
  figure: PlotlyFigure | null
  userLayout?: Record<string, unknown>  // PropertyEditor changes merged on top
  className?: string
  /** Fired when the user brushes a region (box/lasso select). */
  onSelected?: (sel: PlotlySelection) => void
  /** Fired when the user deselects (click on empty plot area). */
  onClearSelection?: () => void
}

export function PlotlyRenderer({
  figure,
  userLayout,
  className,
  onSelected,
  onClearSelection,
}: PlotlyRendererProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  // Bumped by the retry button to re-run the render effect after a failure.
  const [renderRetry, setRenderRetry] = useState(0)
  const panelResizeVersion = useWorkspaceStore((s) => s.panelResizeVersion)
  const theme = useWorkspaceStore((s) => s.theme)
  const systemTheme = useWorkspaceStore((s) => s.systemTheme)
  // Reactive: when the OS theme flips under "system", this re-renders the
  // chart with the matching grid/text colors (dependency in the render effect).
  const isDark = resolvedTheme(theme, systemTheme) === 'dark'
  const onSelectedRef = useRef(onSelected)
  const onClearSelectionRef = useRef(onClearSelection)
  onSelectedRef.current = onSelected
  onClearSelectionRef.current = onClearSelection

  // Check Plotly loaded
  useEffect(() => {
    if (typeof Plotly !== 'undefined') {
      setReady(true)
    } else {
      const timer = setInterval(() => {
        if (typeof Plotly !== 'undefined') {
          setReady(true)
          clearInterval(timer)
        }
      }, 200)
      setTimeout(() => clearInterval(timer), 10000)
    }
  }, [])

  // Render chart with deep-merged layout, plus container/window resize handlers
  useEffect(() => {
    if (!containerRef.current || !figure || !ready) return

    const el = containerRef.current
    // Backend layout hardcodes dark-theme colors; override them to match the UI theme.
    // font.color cascades to tick labels, axis titles and legend text.
    const gridColor = isDark ? '#333333' : '#e5e5e5'
    const themeLayout: Record<string, unknown> = {
      font: { color: isDark ? '#f5f5f5' : '#262626' },
      xaxis: { gridcolor: gridColor, zerolinecolor: gridColor },
      yaxis: { gridcolor: gridColor, zerolinecolor: gridColor },
      xaxis2: { gridcolor: gridColor },
      yaxis2: { gridcolor: gridColor },
    }
    const themeFigure = applyPlotlyUserStyle(
      { data: figure.data, layout: mergePlotlyLayout(figure.layout, themeLayout) },
      userLayout,
    )

    // Clear any stale error first — the canvas container now stays mounted,
    // so every new figure gets a fresh chance to render (v1.7.1).
    setRenderError(null)
    let failed = false
    try {
      const maybePromise = Plotly.react(el, themeFigure.data, themeFigure.layout, {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
      })
      // Async failures inside plotly (bad traces, layout NaN) reject here.
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === 'function') {
        (maybePromise as Promise<unknown>).catch((err: unknown) => {
          setRenderError(err instanceof Error ? err.message : 'Plotly render failed')
        })
      }
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Plotly render failed')
      failed = true
    }

    if (failed) return // don't set up observers if chart didn't render

    // Crossfilter: brush (box/lasso) -> selection; empty click -> clear
    const gd = el as HTMLDivElement & {
      on: (evt: string, cb: (e: unknown) => void) => void
      removeAllListeners?: () => void
    }
    const handleSelected = (e: unknown) => {
      const evt = e as { range?: { xrange?: unknown[]; yrange?: unknown[] } }
      const xr = evt.range?.xrange
      const yr = evt.range?.yrange
      const xRange = xr && xr.length === 2 ? (xr as [number | string, number | string]) : null
      const yRange = yr && yr.length === 2 ? (yr as [number | string, number | string]) : null
      if (xRange || yRange) onSelectedRef.current?.({ xRange, yRange })
    }
    const handleDeselect = () => onClearSelectionRef.current?.()
    try {
      gd.on('plotly_selected', handleSelected)
      gd.on('plotly_deselect', handleDeselect)
    } catch { /* ignore */ }

    // Window resize handler
    const handleWindowResize = () => {
      try { Plotly.Plots.resize(el) } catch { /* ignore */ }
    }
    window.addEventListener('resize', handleWindowResize)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
      try { gd.removeAllListeners?.() } catch { /* ignore */ }
      try { Plotly.purge(el) } catch { /* ignore */ }
    }
  }, [figure, ready, userLayout, isDark, renderRetry])

  // Resize chart when panelResizeVersion changes
  useEffect(() => {
    if (!containerRef.current || !ready) return
    const el = containerRef.current
    try { Plotly.Plots.resize(el) } catch { /* ignore */ }
  }, [panelResizeVersion, ready])

  // The canvas container is ALWAYS mounted; loading/error/empty hints are
  // overlays so a failed render can never leave the plot unable to recover
  // (v1.7.1).
  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          Loading Plotly...
        </div>
      )}
      {ready && renderError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/85 p-3">
          <div className="rounded border border-danger bg-danger/10 p-3 text-center text-xs text-danger">
            <p className="font-semibold">{t('chart.renderError')}</p>
            <p className="mt-1">{renderError}</p>
          </div>
          <Button
            size="sm"
            variant="light"
            startContent={<RotateCcw className="h-3 w-3" />}
            onPress={() => setRenderRetry((n) => n + 1)}
          >
            {t('chart.retryRender')}
          </Button>
        </div>
      )}
      {!figure && !renderError && ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          {t('chart.configureToPreview')}
        </div>
      )}
    </div>
  )
}
