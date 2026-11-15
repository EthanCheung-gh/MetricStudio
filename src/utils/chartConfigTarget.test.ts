import { describe, expect, it } from 'vitest';
import { resolveConfigTarget } from './chartConfigTarget';
import type { ChartConfig } from '@/types/encoding';

function makeChart(id: string, name = id): ChartConfig {
  return {
    id,
    name,
    datasetId: 'ds-1',
    encoding: { chartType: 'scatter', yFields: [] },
    layout: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

const SCATTER = makeChart('chart-a', 'Scatter A');
const BAR = makeChart('chart-b', 'Bar B');

describe('resolveConfigTarget', () => {
  it('is ready with the active chart when the id matches', () => {
    const target = resolveConfigTarget([SCATTER, BAR], 'chart-b');

    expect(target).toEqual({ kind: 'ready', chart: BAR });
  });

  it('asks the user to pick when charts exist but no chart is active', () => {
    const target = resolveConfigTarget([SCATTER, BAR], null);

    expect(target).toEqual({ kind: 'pick', charts: [SCATTER, BAR] });
  });

  it('falls back to picking when the active id is stale (chart was deleted)', () => {
    const target = resolveConfigTarget([SCATTER, BAR], 'chart-gone');

    expect(target).toEqual({ kind: 'pick', charts: [SCATTER, BAR] });
  });

  it('is empty when there are no charts at all', () => {
    expect(resolveConfigTarget([], null)).toEqual({ kind: 'empty' });
  });

  it('stays empty even with a stale id and no charts', () => {
    expect(resolveConfigTarget([], 'chart-gone')).toEqual({ kind: 'empty' });
  });

  it('never returns nothing to render, so the panel is never silent', () => {
    const cases: [ChartConfig[], string | null][] = [
      [[], null],
      [[SCATTER], null],
      [[SCATTER], 'chart-gone'],
      [[SCATTER], 'chart-a'],
    ];

    for (const [charts, activeChartId] of cases) {
      const target = resolveConfigTarget(charts, activeChartId);
      expect(['ready', 'pick', 'empty']).toContain(target.kind);
    }
  });
});
