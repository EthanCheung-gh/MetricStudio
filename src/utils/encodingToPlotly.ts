import type { ChartEncoding, EncodingChannel, ChartType, FieldType, YFieldConfig } from '@/types/encoding';
import type { PlotlyFigure } from '@/types/plotly';
import { chartTypeList } from '@/utils/chartTypeSpecs';

export interface RawRow {
  [key: string]: string | number | boolean | null;
}

function inferType(value: unknown): FieldType {
  if (value === null || value === undefined) return 'nominal';
  if (typeof value === 'number') return 'quantitative';
  if (typeof value === 'boolean') return 'nominal';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'temporal';
    if (!Number.isNaN(Number(value)) && value.trim() !== '') return 'quantitative';
  }
  return 'nominal';
}

function getType(channel: EncodingChannel, rows: RawRow[]): FieldType {
  if (channel.type) return channel.type;
  const sample = rows.find((r) => r[channel.field] !== null && r[channel.field] !== undefined);
  return sample ? inferType(sample[channel.field]) : 'nominal';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function aggregateValue(value: any, _agg: string): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function applyAggregation(rows: RawRow[], channel: EncodingChannel): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[channel.field] ?? '__null__');
    if (!groups.has(key)) groups.set(key, []);
    const val = row[channel.aggregate ? channel.field : channel.field];
    const num = aggregateValue(val, channel.aggregate || 'sum');
    if (num !== null) groups.get(key)!.push(num);
  }
  return groups;
}

function computeAggregate(groups: Map<string, number[]>, agg: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, values] of groups) {
    if (values.length === 0) continue;
    switch (agg) {
      case 'mean':
        result.set(key, values.reduce((a, b) => a + b, 0) / values.length);
        break;
      case 'count':
        result.set(key, values.length);
        break;
      case 'min':
        result.set(key, Math.min(...values));
        break;
      case 'max':
        result.set(key, Math.max(...values));
        break;
      case 'sum':
      default:
        result.set(key, values.reduce((a, b) => a + b, 0));
        break;
    }
  }
  return result;
}

export function encodingToPlotly(
  encoding: ChartEncoding,
  rows: RawRow[],
  _columns: { name: string; inferredType: FieldType }[]
): PlotlyFigure {
  const type = encoding.chartType;
  const yFields = encoding.yFields || [];

  const layout: Record<string, any> = {
    autosize: true,
    margin: { t: 40, r: 20, b: 60, l: 60 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f5f5f5' },
    xaxis: { title: encoding.x?.field, gridcolor: '#333333' },
    yaxis: { title: null, gridcolor: '#333333' },
    showlegend: !!encoding.color || yFields.length > 1,
  };

  // ---- Single-Y types: pie, histogram, box ----
  if (type === 'pie') {
    const colorField = encoding.color?.field;
    const primaryY = yFields[0];
    const valueField = primaryY?.field || encoding.size?.field;
    if (!colorField || !valueField) {
      return { data: [], layout };
    }
    const agg = primaryY?.aggregate || 'sum';
    const groups = applyAggregation(rows, { field: valueField, type: 'quantitative', aggregate: agg });
    const aggregated = computeAggregate(groups, agg);
    const labels = Array.from(aggregated.keys());
    const values = labels.map((l) => aggregated.get(l) ?? 0);
    return {
      data: [
        {
          type: 'pie',
          labels,
          values,
          hole: 0,
          marker: { colors: defaultColors },
        } as any,
      ],
      layout,
    };
  }

  if (type === 'histogram') {
    const primaryY = yFields[0];
    const field = primaryY?.field || encoding.x?.field;
    if (!field) return { data: [], layout };
    const trace: Record<string, unknown> = {
      type: 'histogram',
      x: rows.map((r) => r[field]),
      marker: { color: defaultColors[0] },
      name: field,
    };
    const hOpts = encoding.options;
    if (hOpts?.histnorm) trace.histnorm = hOpts.histnorm;
    if (hOpts?.cumulative) trace.cumulative = { enabled: true };
    return { data: [trace as any], layout };
  }

  // box / violin share the same shape; violin adds a density outline
  if (type === 'box' || type === 'violin') {
    const primaryY = yFields[0];
    const yField = primaryY?.field;
    const colorField = encoding.color?.field;
    if (!yField) return { data: [], layout };
    const dOpts = encoding.options;
    const horizontal = dOpts?.orientation === 'h';
    const points = dOpts?.boxPoints === 'none' ? false : (dOpts?.boxPoints || 'outliers');
    const axisKey = horizontal ? 'x' : 'y';

    const distTrace = (vals: (number | null)[], name: string, idx: number) => {
      const t: Record<string, unknown> = {
        type,
        [axisKey]: vals.filter((v): v is number => v !== null),
        name,
        boxpoints: points,
        marker: { color: defaultColors[idx % defaultColors.length] },
      };
      if (type === 'violin') {
        t.box_visible = true;
        t.meanline_visible = true;
      }
      return t as any;
    };

    if (!colorField) {
      return {
        data: [distTrace(rows.map((r) => aggregateValue(r[yField], 'sum')), primaryY?.label || yField, 0)],
        layout,
      };
    }
    const groups = new Map<string, (number | null)[]>();
    for (const row of rows) {
      const key = String(row[colorField] ?? 'null');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(aggregateValue(row[yField], 'sum'));
    }
    const data: any[] = [];
    let idx = 0;
    for (const [key, vals] of groups) {
      data.push(distTrace(vals, key, idx));
      idx++;
    }
    return { data, layout };
  }

  if (type === 'ecdf') {
    const primaryY = yFields[0];
    const field = primaryY?.field;
    if (!field) return { data: [], layout };
    const colorField = encoding.color?.field;

    const ecdfTrace = (vals: number[], name: string, idx: number) => {
      const xs = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const n = xs.length;
      return {
        type: 'scatter',
        mode: 'lines',
        x: xs,
        y: xs.map((_, i) => (i + 1) / n),
        name,
        marker: { color: defaultColors[idx % defaultColors.length] },
      } as any;
    };

    layout.xaxis.title = primaryY?.label || field;
    layout.yaxis.title = 'ECDF';
    if (!colorField) {
      const vals = rows.map((r) => Number(r[field])).filter((v) => Number.isFinite(v));
      return { data: [ecdfTrace(vals, primaryY?.label || field, 0)], layout };
    }
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const key = String(row[colorField] ?? 'null');
      const v = Number(row[field]);
      if (!Number.isFinite(v)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    }
    const data: any[] = [];
    let idx = 0;
    for (const [key, vals] of groups) {
      data.push(ecdfTrace(vals, key, idx));
      idx++;
    }
    return { data, layout };
  }

  if (type === 'density_heatmap' || type === 'density_contour') {
    const primaryY = yFields[0];
    if (!encoding.x?.field || !primaryY?.field) return { data: [], layout };
    const trace: Record<string, unknown> = {
      type: type === 'density_heatmap' ? 'histogram2d' : 'histogram2dcontour',
      x: rows.map((r) => r[encoding.x!.field]),
      y: rows.map((r) => r[primaryY.field]),
      colorscale: 'Viridis',
    };
    if (type === 'density_contour') trace.contours = { coloring: 'heatmap' };
    return { data: [trace as any], layout };
  }

  if (type === 'heatmap') {
    const hmOpts = encoding.options;
    const annotated = !!hmOpts?.annotated;
    const annotate = (trace: Record<string, unknown>, z: (number | null)[][]) => {
      trace.text = z.map((row) => row.map((v) => (v === null ? '' : v.toFixed(2))));
      trace.texttemplate = '%{text}';
    };

    if (hmOpts?.corr) {
      // One-click correlation matrix over all (mostly-)numeric columns
      const sample = rows[0] || {};
      const cols = Object.keys(sample).filter(
        (c) => rows.filter((r) => Number.isFinite(Number(r[c]))).length > rows.length / 2,
      );
      if (cols.length < 2) return { data: [], layout };
      const vectors = cols.map((c) => rows.map((r) => Number(r[c])));
      const z: (number | null)[][] = cols.map((_, i) =>
        cols.map((_, j) => {
          const v = pearson(vectors[i], vectors[j]);
          return Number.isNaN(v) ? null : v;
        }),
      );
      const trace: Record<string, unknown> = {
        type: 'heatmap', x: cols, y: cols, z,
        colorscale: 'RdBu', zmin: -1, zmax: 1, reversescale: true,
      };
      if (annotated) annotate(trace, z);
      return { data: [trace as any], layout };
    }

    const primaryY = yFields[0];
    if (!encoding.x?.field || !primaryY?.field || !encoding.z?.field) return { data: [], layout };
    const { xs, ys, z } = pivotMatrix(rows, encoding.x.field, primaryY.field, encoding.z.field);
    const trace: Record<string, unknown> = { type: 'heatmap', x: xs, y: ys, z, colorscale: 'Viridis' };
    if (annotated) annotate(trace, z);
    return { data: [trace as any], layout };
  }

  if (type === 'contour') {
    const primaryY = yFields[0];
    if (!encoding.x?.field || !primaryY?.field || !encoding.z?.field) return { data: [], layout };
    const { xs, ys, z } = pivotMatrix(rows, encoding.x.field, primaryY.field, encoding.z.field);
    return {
      data: [{ type: 'contour', x: xs, y: ys, z, colorscale: 'Viridis', contours: { coloring: 'heatmap' } } as any],
      layout,
    };
  }

  if (type === 'splom') {
    const dims = (encoding.dimensions || []).filter((d) => rows.length === 0 || d in (rows[0] || {}));
    if (dims.length < 2) return { data: [], layout };
    const trace: Record<string, unknown> = {
      type: 'splom',
      dimensions: dims.map((d) => ({ label: d, values: rows.map((r) => Number(r[d])) })),
      marker: { color: defaultColors[0], size: 5, opacity: 0.7 },
    };
    const colorField = encoding.color?.field;
    if (colorField) {
      const uniq: string[] = [];
      (trace.marker as Record<string, unknown>).color = rows.map((r) => {
        const c = String(r[colorField] ?? 'null');
        let i = uniq.indexOf(c);
        if (i === -1) {
          uniq.push(c);
          i = uniq.length - 1;
        }
        return i;
      });
    }
    return { data: [trace as any], layout };
  }

  // ---- Hierarchical: treemap / sunburst / icicle (path levels + value) ----
  if (type === 'treemap' || type === 'sunburst' || type === 'icicle') {
    const path = (encoding.path || []).filter((p) => rows.length === 0 || p in (rows[0] || {}));
    const primaryY = yFields[0];
    if (path.length === 0 || !primaryY?.field) return { data: [], layout };
    const agg = primaryY.aggregate || 'sum';
    const ids: string[] = [];
    const labels: string[] = [];
    const parents: string[] = [];
    const values: number[] = [];
    for (let level = 0; level < path.length; level++) {
      const cols = path.slice(0, level + 1);
      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const key = cols.map((c) => String(row[c] ?? 'null')).join('/');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(aggregateValue(row[primaryY.field], agg) ?? 0);
      }
      for (const [key, vals] of groups) {
        ids.push(key);
        labels.push(key.split('/').pop()!);
        parents.push(key.split('/').slice(0, -1).join('/'));
        values.push(computeAggregate(new Map([[key, vals]]), agg).get(key) ?? 0);
      }
    }
    return {
      data: [{ type, ids, labels, parents, values, branchvalues: 'total' } as any],
      layout,
    };
  }

  if (type === 'sankey') {
    const src = encoding.source?.field;
    const tgt = encoding.target?.field;
    const primaryY = yFields[0];
    if (!src || !tgt || !primaryY?.field) return { data: [], layout };
    const agg = primaryY.aggregate || 'sum';
    const nodes: string[] = [];
    const nodeIdx = (name: string) => {
      let i = nodes.indexOf(name);
      if (i === -1) {
        nodes.push(name);
        i = nodes.length - 1;
      }
      return i;
    };
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const key = `${String(row[src] ?? 'null')} ${String(row[tgt] ?? 'null')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(aggregateValue(row[primaryY.field], agg) ?? 0);
    }
    const sources: number[] = [];
    const targets: number[] = [];
    const values: number[] = [];
    for (const [key, vals] of groups) {
      const [s, t] = key.split(' ');
      sources.push(nodeIdx(s));
      targets.push(nodeIdx(t));
      values.push(computeAggregate(new Map([[key, vals]]), agg).get(key) ?? 0);
    }
    return {
      data: [{
        type: 'sankey',
        node: { label: nodes, pad: 12, thickness: 16 },
        link: { source: sources, target: targets, value: values },
      } as any],
      layout,
    };
  }

  if (type === 'parcoords') {
    const dims = (encoding.dimensions || []).filter((d) => rows.length === 0 || d in (rows[0] || {}));
    if (dims.length < 2) return { data: [], layout };
    const trace: Record<string, unknown> = {
      type: 'parcoords',
      dimensions: dims.map((d) => ({ label: d, values: rows.map((r) => Number(r[d])) })),
      line: {},
    };
    const colorField = encoding.color?.field;
    if (colorField) {
      const uniq: string[] = [];
      const colorIdx = rows.map((r) => {
        const c = String(r[colorField] ?? 'null');
        let i = uniq.indexOf(c);
        if (i === -1) {
          uniq.push(c);
          i = uniq.length - 1;
        }
        return i;
      });
      const n = uniq.length;
      const colorscale: [number, string][] = n === 1
        ? [[0, defaultColors[0]], [1, defaultColors[0]]]
        : uniq.map((_, i) => [i / (n - 1), defaultColors[i % defaultColors.length]]);
      trace.line = { color: colorIdx, colorscale };
    }
    return { data: [trace as any], layout };
  }

  if (type === 'parcats') {
    const dims = (encoding.dimensions || []).filter((d) => rows.length === 0 || d in (rows[0] || {}));
    if (dims.length < 2) return { data: [], layout };
    return {
      data: [{
        type: 'parcats',
        dimensions: dims.map((d) => ({ label: d, values: rows.map((r) => String(r[d] ?? 'null')) })),
      } as any],
      layout,
    };
  }

  // ---- Coordinate variants & misc: radar / ternary / waterfall / funnel / table / gantt ----
  if (type === 'radar') {
    if (!encoding.x?.field || yFields.length === 0) return { data: [], layout };
    const xField = encoding.x.field;
    const data = yFields.map((yf, idx) => {
      const agg = yf.aggregate || 'sum';
      const perX = new Map<string, number[]>();
      for (const row of rows) {
        const key = String(row[xField] ?? 'null');
        if (!perX.has(key)) perX.set(key, []);
        perX.get(key)!.push(aggregateValue(row[yf.field], agg) ?? 0);
      }
      const keys = sortKeys(Array.from(perX.keys()), 'nominal');
      const theta = [...keys];
      const r = keys.map((k) => computeAggregate(new Map([[k, perX.get(k)!]]), agg).get(k) ?? 0);
      if (theta.length > 0) {
        theta.push(theta[0]); // close the loop
        r.push(r[0]);
      }
      return {
        type: 'scatterpolar',
        r,
        theta,
        fill: 'toself',
        name: yf.label || yf.field,
        marker: { color: defaultColors[idx % defaultColors.length] },
      } as any;
    });
    layout.polar = { bgcolor: 'rgba(0,0,0,0)' };
    return { data, layout };
  }

  if (type === 'ternary') {
    const primaryY = yFields[0];
    if (!encoding.x?.field || !primaryY?.field || !encoding.z?.field) return { data: [], layout };
    const aField = encoding.x.field;
    const bField = primaryY.field;
    const cField = encoding.z.field;
    const colorField = encoding.color?.field;

    const ternaryTrace = (subset: RawRow[], name: string, idx: number) => ({
      type: 'scatterternary',
      mode: 'markers',
      a: subset.map((r) => Number(r[aField])),
      b: subset.map((r) => Number(r[bField])),
      c: subset.map((r) => Number(r[cField])),
      name,
      marker: { color: defaultColors[idx % defaultColors.length], size: 6 },
    } as any);

    if (!colorField) {
      return { data: [ternaryTrace(rows, primaryY.label || bField, 0)], layout };
    }
    const groups = new Map<string, RawRow[]>();
    for (const row of rows) {
      const key = String(row[colorField] ?? 'null');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const data: any[] = [];
    let idx = 0;
    for (const [key, subset] of groups) {
      data.push(ternaryTrace(subset, key, idx));
      idx++;
    }
    return { data, layout };
  }

  if (type === 'waterfall') {
    const primaryY = yFields[0];
    if (!encoding.x?.field || !primaryY?.field) return { data: [], layout };
    const xField = encoding.x.field;
    const agg = primaryY.aggregate || 'sum';
    const perX = new Map<string, number[]>();
    for (const row of rows) {
      const key = String(row[xField] ?? 'null');
      if (!perX.has(key)) perX.set(key, []);
      perX.get(key)!.push(aggregateValue(row[primaryY.field], agg) ?? 0);
    }
    const keys = sortKeys(Array.from(perX.keys()), getType(encoding.x, rows));
    const values = keys.map((k) => computeAggregate(new Map([[k, perX.get(k)!]]), agg).get(k) ?? 0);
    return {
      data: [{
        type: 'waterfall',
        x: keys,
        y: values,
        measure: keys.map(() => 'relative'),
      } as any],
      layout,
    };
  }

  if (type === 'funnel') {
    const primaryY = yFields[0];
    if (!encoding.x?.field || !primaryY?.field) return { data: [], layout };
    const xField = encoding.x.field;
    const agg = primaryY.aggregate || 'sum';
    // Preserve stage order as it appears in the data
    const keys: string[] = [];
    const perX = new Map<string, number[]>();
    for (const row of rows) {
      const key = String(row[xField] ?? 'null');
      if (!perX.has(key)) {
        perX.set(key, []);
        keys.push(key);
      }
      perX.get(key)!.push(aggregateValue(row[primaryY.field], agg) ?? 0);
    }
    return {
      data: [{
        type: 'funnel',
        y: keys,
        x: keys.map((k) => computeAggregate(new Map([[k, perX.get(k)!]]), agg).get(k) ?? 0),
        marker: { color: defaultColors },
      } as any],
      layout,
    };
  }

  if (type === 'table') {
    const dims = (encoding.dimensions || []).filter((d) => rows.length === 0 || d in (rows[0] || {}));
    if (dims.length === 0) return { data: [], layout };
    return {
      data: [{
        type: 'table',
        header: { values: dims, fill: { color: '#1f2937' }, font: { color: '#f5f5f5' } },
        cells: {
          values: dims.map((d) => rows.map((r) => String(r[d] ?? ''))),
          fill: { color: '#111827' },
          font: { color: '#d1d5db' },
        },
      } as any],
      layout,
    };
  }

  if (type === 'gantt') {
    const gOpts = encoding.options;
    const startF = gOpts?.startField;
    const endF = gOpts?.endField;
    const primaryY = yFields[0];
    if (!startF || !endF || !primaryY?.field) return { data: [], layout };
    const taskF = primaryY.field;
    const colorField = encoding.color?.field;

    const groups = new Map<string, RawRow[]>();
    for (const row of rows) {
      const key = colorField ? String(row[colorField] ?? 'null') : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const data: any[] = [];
    let idx = 0;
    for (const [key, subset] of groups) {
      data.push({
        type: 'bar',
        orientation: 'h',
        base: subset.map((r) => String(r[startF] ?? '')),
        // plotly date axis accepts durations in milliseconds when base is a date
        x: subset.map((r) => {
          const s = new Date(String(r[startF])).getTime();
          const e = new Date(String(r[endF])).getTime();
          return Number.isFinite(s) && Number.isFinite(e) ? e - s : 0;
        }),
        y: subset.map((r) => String(r[taskF] ?? '')),
        name: key || 'Tasks',
        marker: { color: defaultColors[idx % defaultColors.length] },
      } as any);
      idx++;
    }
    layout.xaxis.type = 'date';
    layout.barmode = 'stack';
    return { data, layout };
  }

  // ---- Facet mode: split the multi-Y family into a subplot grid ----
  const facetField = encoding.facet?.field;
  if (
    ['line', 'bar', 'area', 'step', 'scatter', 'dot'].includes(type) &&
    facetField &&
    (rows.length === 0 || facetField in (rows[0] || {})) &&
    yFields.length > 0
  ) {
    const fxField = encoding.x?.field;
    const groups = new Map<string, RawRow[]>();
    for (const row of rows) {
      const key = String(row[facetField] ?? 'null');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const entries = Array.from(groups.entries());
    const n = entries.length;
    const ncols = Math.min(n, 3);
    layout.grid = { rows: Math.ceil(n / ncols), columns: ncols, pattern: 'independent', xgap: 0.08, ygap: 0.12 };

    const data: any[] = [];
    entries.forEach(([gname, gdf], gi) => {
      const suffix = gi === 0 ? '' : String(gi + 1);
      const xa = `x${suffix}`;
      const ya = `y${suffix}`;
      const xKey = `xaxis${suffix}`;
      const yKey = `yaxis${suffix}`;
      if (!layout[xKey]) layout[xKey] = {};
      layout[xKey].title = gname;
      if (!layout[yKey]) layout[yKey] = {};

      yFields.forEach((yf, fi) => {
        const agg = yf.aggregate || 'sum';
        let gx: string[];
        let gy: number[];
        if (fxField && yf.aggregate) {
          const perX = new Map<string, number[]>();
          for (const row of gdf) {
            const key = String(row[fxField] ?? 'null');
            if (!perX.has(key)) perX.set(key, []);
            perX.get(key)!.push(aggregateValue(row[yf.field], agg) ?? 0);
          }
          gx = sortKeys(Array.from(perX.keys()), getType(encoding.x!, gdf));
          gy = gx.map((k) => computeAggregate(new Map([[k, perX.get(k)!]]), agg).get(k) ?? 0);
        } else {
          gx = fxField ? gdf.map((r) => String(r[fxField] ?? '')) : gdf.map((_, i) => String(i));
          gy = gdf.map((r) => aggregateValue(r[yf.field], 'sum') ?? 0);
        }
        data.push(styleDatum({
          type: traceType(type),
          mode: traceMode(type),
          x: gx,
          y: gy,
          name: yf.label || yf.field,
          xaxis: xa,
          yaxis: ya,
          legendgroup: yf.label || yf.field,
          showlegend: gi === 0,
          marker: { color: defaultColors[fi % defaultColors.length] },
        }, type, false));
      });
    });
    return { data, layout };
  }

  if (type === 'scatter3d') {
    const xf = encoding.x?.field;
    const zf = encoding.z?.field;
    const primary = yFields[0];
    if (!xf || !zf || !primary) return { data: [], layout };
    const trace: any = {
      type: 'scatter3d',
      mode: 'markers',
      x: rows.map((r) => Number(r[xf]) || null),
      y: rows.map((r) => Number(r[primary.field]) || null),
      z: rows.map((r) => Number(r[zf]) || null),
      marker: { size: 4, color: defaultColors[0] },
    };
    const cf = encoding.color?.field;
    if (cf) {
      const cats = rows.map((r) => String(r[cf] ?? ''));
      const uniq = [...new Set(cats)];
      trace.marker.color = cats.map((c) => uniq.indexOf(c));
      trace.marker.colorscale = uniq.map((_, i) => [
        i / Math.max(1, uniq.length - 1),
        defaultColors[i % defaultColors.length],
      ]);
    }
    layout.scene = {
      bgcolor: 'rgba(0,0,0,0)',
      xaxis: { title: xf },
      yaxis: { title: primary.field },
      zaxis: { title: zf },
    };
    return { data: [trace], layout };
  }

  // ---- Multi-Y types: line, bar, scatter ----
  if (yFields.length === 0) {
    return { data: [], layout };
  }

  if (type === 'scatter' && !encoding.x) {
    return { data: [], layout };
  }

  // Auto-index X
  const autoIndex = !encoding.x || !encoding.x.field;

  // Build axis titles
  const leftLabels = yFields.filter((yf) => yf.axis === 'left').map((yf) => yf.label || yf.field);
  const rightLabels = yFields.filter((yf) => yf.axis === 'right').map((yf) => yf.label || yf.field);
  if (leftLabels.length > 0) {
    layout.yaxis.title = leftLabels.join(' / ');
  }
  const hasRightAxis = yFields.some((yf) => yf.axis === 'right');
  if (hasRightAxis) {
    layout.yaxis2 = {
      title: rightLabels.join(' / ') || 'Right Y',
      side: 'right',
      overlaying: 'y',
      anchor: 'x',
      gridcolor: '#333333',
    };
  }

  const stackMode = (type === 'bar' || type === 'barh' || type === 'area') && encoding.options?.barmode === 'stack';
  if (stackMode && (type === 'bar' || type === 'barh')) {
    layout.barmode = 'stack';
  }

  const data: any[] = [];
  const traceNorms: YFieldConfig['normalize'][] = []; // parallel to data
  let globalColorIdx = 0;
  const colorField = encoding.color?.field;
  const xType = encoding.x ? getType(encoding.x, rows) : 'quantitative';

  for (const yf of yFields) {
    const yAxis = yf.axis === 'right' ? 'y2' : 'y';
    const traceName = yf.label || yf.field;
    const yAgg = yf.aggregate;

    if (!colorField) {
      // Single trace per Y field
      let traceX: string[];
      let traceY: number[];

      if (autoIndex) {
        // Auto-index: every x value is unique, so aggregation is a no-op
        // (each group has exactly 1 row). Return raw per-row values.
        traceX = rows.map((_, i) => String(i));
        traceY = rows.map((r) => aggregateValue(r[yf.field], 'sum') ?? 0);
      } else {
        // X field exists
        if (!yAgg) {
          traceX = rows.map((r) => String(r[encoding.x!.field] ?? ''));
          traceY = rows.map((r) => aggregateValue(r[yf.field], 'sum') ?? 0);
        } else {
          const groups = applyAggregation(rows, { field: encoding.x!.field, type: 'nominal', aggregate: yAgg });
          const aggregated = computeAggregate(groups, yAgg);
          const sortedKeys = sortKeys(Array.from(aggregated.keys()), xType);
          traceX = sortedKeys;
          traceY = sortedKeys.map((k) => aggregated.get(k) ?? 0);
        }
      }

      const marker: Record<string, unknown> = { color: defaultColors[globalColorIdx % defaultColors.length] };
      // Bubble scatter: size channel (raw-row paths only, lengths must match)
      if (type === 'scatter' && encoding.size?.field && !yAgg) {
        const sizeVals = rows.map((r) => {
          const v = Number(r[encoding.size!.field]);
          return Number.isFinite(v) ? Math.abs(v) : 0;
        });
        const maxAbs = Math.max(0, ...sizeVals);
        if (maxAbs > 0) {
          marker.size = sizeVals;
          marker.sizemode = 'diameter';
          marker.sizeref = (2.0 * maxAbs) / (40 * 40);
        }
      }
      const datum: Record<string, unknown> = {
        type: traceType(type),
        mode: traceMode(type),
        x: traceX,
        y: traceY,
        name: traceName,
        yaxis: yAxis,
        marker,
      };
      // Error bars (raw-row path only)
      if (encoding.error?.field && !yAgg && ['line', 'bar', 'scatter', 'area', 'step'].includes(type)) {
        datum.error_y = {
          type: 'data',
          array: rows.map((r) => Number(r[encoding.error!.field]) || 0),
          visible: true,
        };
      }
      data.push(styleDatum(datum, type, stackMode));
      traceNorms.push(yf.normalize || 'none');
      globalColorIdx++;
    } else {
      // Multi-series: one trace per color value, grouped under this Y field
      const allXKeys = new Set<string>();

      if (autoIndex) {
        for (let i = 0; i < rows.length; i++) {
          allXKeys.add(String(i));
        }
      } else {
        for (const row of rows) {
          allXKeys.add(String(row[encoding.x!.field] ?? ''));
        }
      }
      const sortedX = sortKeys(Array.from(allXKeys), autoIndex ? 'quantitative' : xType);

      // Group rows by color
      const colorGroups = new Map<string, Map<string, number[]>>();
      for (const row of rows) {
        const seriesKey = String(row[colorField] ?? 'null');
        if (!colorGroups.has(seriesKey)) colorGroups.set(seriesKey, new Map());
        const inner = colorGroups.get(seriesKey)!;
        const xKey = autoIndex ? String(rows.indexOf(row)) : String(row[encoding.x!.field] ?? '');
        if (!inner.has(xKey)) inner.set(xKey, []);
        const num = aggregateValue(row[yf.field], yAgg || 'sum');
        if (num !== null) inner.get(xKey)!.push(num);
      }

      for (const [seriesKey, inner] of colorGroups) {
        const yVals = sortedX.map((k) => {
          const vals = inner.get(k);
          if (!vals || vals.length === 0) return 0;
          return computeAggregate(new Map([[k, vals]]), yAgg || 'sum').get(k) ?? 0;
        });
        data.push(styleDatum({
          type: traceType(type),
          mode: traceMode(type),
          x: sortedX,
          y: yVals,
          name: `${traceName} - ${seriesKey}`,
          yaxis: yAxis,
          marker: { color: defaultColors[globalColorIdx % defaultColors.length] },
        }, type, stackMode));
        traceNorms.push(yf.normalize || 'none');
        globalColorIdx++;
      }
    }
  }

  // ---- Normalization: perSeries (÷ own max) / global (÷ max across all y-fields) ----
  if (traceNorms.some((m) => m !== 'none')) {
    const absNums = (vals: unknown[]): number[] =>
      vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map(Math.abs);

    let globalMax = 0;
    traceNorms.forEach((mode, i) => {
      if (mode !== 'global') return;
      const m = Math.max(0, ...absNums(data[i].y));
      if (m > globalMax) globalMax = m;
    });

    traceNorms.forEach((mode, i) => {
      if (mode === 'none') return;
      const denom = mode === 'global' ? globalMax : Math.max(0, ...absNums(data[i].y));
      if (!denom) return;
      data[i].y = (data[i].y as unknown[]).map((v) =>
        typeof v === 'number' && Number.isFinite(v) ? v / denom : v,
      );
      data[i].name = `${data[i].name} (normalized)`;
    });

    // Annotate axis titles that carry normalized series
    const leftNorm = traceNorms.some((m, i) => m !== 'none' && data[i].yaxis === 'y');
    const rightNorm = traceNorms.some((m, i) => m !== 'none' && data[i].yaxis === 'y2');
    if (leftNorm && layout.yaxis.title) layout.yaxis.title += ' (normalized)';
    if (rightNorm && layout.yaxis2?.title) layout.yaxis2.title += ' (normalized)';
  }

  // ---- Marginal distributions for scatter (px-style marginal_x/marginal_y) ----
  const mOpts = encoding.options;
  if (type === 'scatter' && (mOpts?.marginalX || mOpts?.marginalY) && yFields[0]) {
    const marginalTrace = (kind: string, vals: unknown[], axis: 'x' | 'y'): any => {
      let t: Record<string, unknown>;
      if (kind === 'histogram') {
        t = { type: 'histogram', showlegend: false, marker: { color: '#888888' } };
      } else if (kind === 'box') {
        t = { type: 'box', showlegend: false, boxpoints: false, marker: { color: '#888888' } };
      } else if (kind === 'violin') {
        t = { type: 'violin', showlegend: false, box_visible: false, points: false, marker: { color: '#888888' } };
      } else {
        // rug → emulate with a box showing only points
        t = {
          type: 'box', showlegend: false, boxpoints: 'all',
          fillcolor: 'rgba(0,0,0,0)', line: { width: 0 },
          marker: { color: '#888888', size: 4 },
        };
      }
      if (axis === 'x') {
        t.x = vals;
        t.yaxis = 'y2';
      } else {
        t.y = vals;
        t.xaxis = 'x2';
      }
      return t;
    };

    // Shrink the main plot into the lower-left quadrant
    layout.xaxis.domain = [0, 0.8];
    layout.yaxis.domain = [0, 0.8];
    if (mOpts.marginalX && encoding.x?.field) {
      data.push(marginalTrace(mOpts.marginalX, rows.map((r) => r[encoding.x!.field]), 'x'));
      layout.yaxis2 = { domain: [0.82, 1], showticklabels: false };
    }
    if (mOpts.marginalY) {
      data.push(marginalTrace(mOpts.marginalY, rows.map((r) => r[yFields[0].field]), 'y'));
      layout.xaxis2 = { domain: [0.82, 1], showticklabels: false };
    }
  }

  return { data, layout };
}

function traceType(type: ChartType): string {
  if (type === 'line' || type === 'area' || type === 'step' || type === 'dot') return 'scatter';
  if (type === 'barh') return 'bar';
  return type;
}

function traceMode(type: ChartType): string | undefined {
  if (type === 'line') return 'lines+markers';
  if (type === 'area' || type === 'step') return 'lines';
  if (type === 'dot') return 'markers';
  return undefined;
}

/** Apply area/step/barh specifics to a trace built with the standard scatter/bar shape. */
function styleDatum(datum: any, type: ChartType, stackMode: boolean): any {
  if (type === 'area' || type === 'step') datum.fill = 'tozeroy';
  if (type === 'area' && stackMode) datum.stackgroup = 'one';
  if (type === 'step') datum.line = { shape: 'hv' };
  if (type === 'dot') datum.marker = { ...(datum.marker || {}), size: 9 };
  if (type === 'barh') {
    // Horizontal bar: categories go to Y, values to X
    datum.orientation = 'h';
    const t = datum.x; datum.x = datum.y; datum.y = t;
    delete datum.yaxis;
  }
  return datum;
}

/** Pearson correlation between two vectors, skipping pairs where either side is non-finite. */
function pearson(xs: number[], ys: number[]): number {
  const pairs: [number, number][] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  const n = pairs.length;
  if (n < 2) return NaN;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [a0, b0] of pairs) {
    const a = a0 - mx;
    const b = b0 - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

/** Pivot rows into an x/y matrix of mean z values (null = no data). */
function pivotMatrix(rows: RawRow[], xField: string, yField: string, zField: string) {
  const xs: string[] = [];
  const ys: string[] = [];
  const cell = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const x = String(r[xField] ?? '');
    const y = String(r[yField] ?? '');
    const v = Number(r[zField]);
    if (!xs.includes(x)) xs.push(x);
    if (!ys.includes(y)) ys.push(y);
    if (Number.isFinite(v)) {
      const k = `${y} ${x}`;
      const c = cell.get(k) || { sum: 0, n: 0 };
      c.sum += v;
      c.n += 1;
      cell.set(k, c);
    }
  }
  const z = ys.map((y) =>
    xs.map((x) => {
      const c = cell.get(`${y} ${x}`);
      return c ? c.sum / c.n : null;
    }),
  );
  return { xs, ys, z };
}

function sortKeys(keys: string[], type: FieldType): string[] {
  if (type === 'quantitative' || type === 'temporal') {
    return [...keys].sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

export const defaultColors = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#6366f1',
];

export const chartTypeOptions: { value: ChartType; label: string }[] = chartTypeList;

export const aggregateOptions: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'sum', label: 'Sum' },
  { value: 'mean', label: 'Mean' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];
