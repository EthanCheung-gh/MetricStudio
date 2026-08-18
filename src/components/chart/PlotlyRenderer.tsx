import { useEffect, useRef, useState } from 'react'
import type { PlotlyFigure } from '@/types/plotly'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { applyPlotlyUserStyle, mergePlotlyLayout } from '@/utils/plotlyLayout'

declare const Plotly: {
  react: (el: HTMLElement, data: unknown[], layout: unknown, config?: unknown) => void
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
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const panelResizeVersion = useWorkspaceStore((s) => s.panelResizeVersion)
  const theme = useWorkspaceStore((s) => s.theme)
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
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

    try {
      setRenderError(null)
      Plotly.react(el, themeFigure.data, themeFigure.layout, {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
      })
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Plotly render failed')
      return // don't set up observers if chart didn't render
    }

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
  }, [figure, ready, userLayout, isDark])

  // Resize chart when panelResizeVersion changes
  useEffect(() => {
    if (!containerRef.current || !ready) return
    const el = containerRef.current
    try { Plotly.Plots.resize(el) } catch { /* ignore */ }
  }, [panelResizeVersion, ready])

  if (!ready) {
    return (
      <div className={`flex items-center justify-center text-sm text-muted ${className}`}>
        Loading Plotly...
      </div>
    )
  }

  if (renderError) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="rounded border border-danger bg-danger/10 p-3 text-center text-xs text-danger">
          <p className="font-semibold">Chart render error</p>
          <p className="mt-1">{renderError}</p>
        </div>
      </div>
    )
  }

  if (!figure) {
    return (
      <div className={`flex items-center justify-center text-sm text-muted ${className}`}>
        Configure chart encoding to preview
      </div>
    )
  }

  return <div ref={containerRef} className={`h-full w-full ${className}`} />
}
