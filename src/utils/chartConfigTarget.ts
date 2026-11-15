/**
 * What the chart-config panel should show for the current chart state.
 *
 * The panel used to bail out (`return null`) whenever there was no active
 * chart, so every 图表配置 button in the app looked dead: no charts yet, the
 * active chart was deleted, or a restored `activeChartId` pointed at a chart
 * that no longer exists. The decision is pure so it can be unit-tested without
 * a DOM; the component only renders the matching state.
 */
import type { ChartConfig } from '@/types/encoding'

export type ConfigTarget =
  /** An active chart exists and is still in the store — show the normal panel. */
  | { kind: 'ready'; chart: ChartConfig }
  /** Charts exist but none is active (null id or stale id) — let the user pick one. */
  | { kind: 'pick'; charts: readonly ChartConfig[] }
  /** No charts at all — offer to create one (dataset permitting). */
  | { kind: 'empty' }

export function resolveConfigTarget(
  charts: readonly ChartConfig[],
  activeChartId: string | null,
): ConfigTarget {
  if (charts.length === 0) return { kind: 'empty' }
  const chart = activeChartId ? charts.find((c) => c.id === activeChartId) : undefined
  if (chart) return { kind: 'ready', chart }
  // Charts are there, but the active id is null or stale: never render nothing.
  return { kind: 'pick', charts }
}
