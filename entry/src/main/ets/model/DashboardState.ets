/**
 * Dashboard model (web: stores/dashboardStore.ts + types/dashboard.ts).
 * 12-col grid (80px rows, 8px gaps) with absolute item layout, vertical
 * compaction + collision push-down, edit/lock modes, filter list and an
 * undo/redo snapshot stack (move/resize stay out of the stack — web parity).
 */
import { CellValue, DataFrame } from './DataFrame';
import { toNumber } from '../engine/Numeric';
import { Settings } from '../common/Settings';

export enum DashboardItemKind {
  Chart = 0,
  Kpi = 1,
  Text = 2
}

/** Grid metrics (web: cols 12, rowHeight 80, margin [8,8]). */
export const DASH_COLS: number = 12;
export const DASH_ROW_H: number = 80;
export const DASH_GAP: number = 8;
export const DASH_MIN_W: number = 3;
export const DASH_MIN_H: number = 2;

@Observed
export class DashboardItem {
  id: string;
  kind: DashboardItemKind;
  chartId: string; // Chart: referenced chart id
  label: string;   // KPI: display label
  column: string;  // KPI: value column
  agg: string;     // KPI: sum | mean | count | min | max
  text: string;    // Text: content
  x: number = 0;
  y: number = 0;
  w: number = 6;
  h: number = 4;
  locked: boolean = false;

  constructor(kind: DashboardItemKind, chartId: string = '', label: string = '', column: string = '',
    agg: string = 'sum', text: string = '') {
    this.id = 'dash_' + Date.now().toString() + '_' + Math.floor(Math.random() * 100000).toString();
    this.kind = kind;
    this.chartId = chartId;
    this.label = label;
    this.column = column;
    this.agg = agg;
    this.text = text;
    // default sizes (web dashboardStore: chart 6x4, kpi 3x2, text 4x2)
    if (kind === DashboardItemKind.Kpi) {
      this.w = 3;
      this.h = 2;
    } else if (kind === DashboardItemKind.Text) {
      this.w = 4;
      this.h = 2;
    }
  }
}

/** One dashboard filter (web DashboardFilter; value semantics per kind). */
@Observed
export class DashboardFilter {
  id: string;
  field: string;
  kind: string;          // 'category' | 'range' | 'date'
  values: string[] = []; // category: selected values (op 'in')
  lo: string = '';       // range/date: lower bound ('' = open)
  hi: string = '';       // range/date: upper bound ('' = open)

  constructor(field: string, kind: string) {
    this.id = 'flt_' + Date.now().toString() + '_' + Math.floor(Math.random() * 100000).toString();
    this.field = field;
    this.kind = kind;
  }
}

/** Deep copy helpers for the snapshot stack. */
function copyItems(items: DashboardItem[]): DashboardItem[] {
  const out: DashboardItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    const c = new DashboardItem(s.kind, s.chartId, s.label, s.column, s.agg, s.text);
    c.id = s.id; // keep stable ids (brush map + ForEach keys depend on them)
    c.x = s.x;
    c.y = s.y;
    c.w = s.w;
    c.h = s.h;
    c.locked = s.locked;
    out.push(c);
  }
  return out;
}

function copyFilters(filters: DashboardFilter[]): DashboardFilter[] {
  const out: DashboardFilter[] = [];
  for (let i = 0; i < filters.length; i++) {
    const s = filters[i];
    const c = new DashboardFilter(s.field, s.kind);
    c.values = s.values.slice();
    c.lo = s.lo;
    c.hi = s.hi;
    out.push(c);
  }
  return out;
}

interface DashSnapshotJson {
  items: object[];
  filters: object[];
}

/** One named dashboard (web DashboardConfig; 12-col grid doc). */
@Observed
export class DashboardDoc {
  id: string;
  name: string;
  items: DashboardItem[] = [];
  filters: DashboardFilter[] = [];
  createdAt: string;
  updatedAt: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }
}

/** Saved layout (web LayoutTemplate — item positions only). */
export class LayoutTemplateDoc {
  id: string;
  name: string;
  layout: string; // JSON: [{chartId,x,y,w,h}]
  createdAt: string;

  constructor(id: string, name: string, layout: string) {
    this.id = id;
    this.name = name;
    this.layout = layout;
    this.createdAt = new Date().toISOString();
  }
}

interface LayoutEntryJson {
  chartId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Import shape of one dashboard doc (project manifest dashboards[]). */
export interface DashboardDocJson {
  id?: string;
  name?: string;
  items?: DashboardItemJson2[];
  filters?: DashboardFilterJson2[];
}

export interface DashboardItemJson2 {
  kind: number;
  chartId: string;
  label?: string;
  column?: string;
  agg?: string;
  text?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  locked?: boolean;
}

export interface DashboardFilterJson2 {
  id?: string;
  field: string;
  kind: string;
  values?: string[];
  lo?: string;
  hi?: string;
}

export class DashboardState {
  items: DashboardItem[] = [];
  filters: DashboardFilter[] = [];
  editMode: boolean = true;
  tick: number = 0;
  // 多 Dashboard（web dashboardStore dashboards + activeId）
  dashboards: DashboardDoc[] = [];
  activeId: string = '';
  // 布局模板（web LayoutTemplate，Preferences 持久化）
  layoutTemplates: LayoutTemplateDoc[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  /** Keep the active doc's arrays pointing at the live fields. */
  private syncActiveDoc(): void {
    const doc = this.findDoc(this.activeId);
    if (doc !== null) {
      doc.items = this.items;
      doc.filters = this.filters;
      doc.updatedAt = new Date().toISOString();
    }
  }

  findDoc(id: string): DashboardDoc | null {
    for (let i = 0; i < this.dashboards.length; i++) {
      if (this.dashboards[i].id === id) {
        return this.dashboards[i];
      }
    }
    return null;
  }

  activeDoc(): DashboardDoc | null {
    return this.findDoc(this.activeId);
  }

  /** Public sync for export paths (no tick bump). */
  syncForExport(): void {
    this.syncActiveDoc();
  }

  /** Restore dashboards from a project payload (web manifest dashboards). */
  importDocs(docs: DashboardDocJson[], activeId: string): void {
    this.dashboards = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const doc = new DashboardDoc(d.id !== undefined && d.id.length > 0 ? d.id : 'dashb_' + i.toString(),
        d.name !== undefined && d.name.length > 0 ? d.name : 'Dashboard ' + (i + 1).toString());
      if (d.items !== undefined) {
        for (let k = 0; k < d.items.length; k++) {
          const j = d.items[k];
          const kind = j.kind === DashboardItemKind.Kpi ? DashboardItemKind.Kpi
            : (j.kind === DashboardItemKind.Text ? DashboardItemKind.Text : DashboardItemKind.Chart);
          const item = new DashboardItem(kind, j.chartId, j.label, j.column, j.agg, j.text);
          if (j.x !== undefined) {
            item.x = j.x;
          }
          if (j.y !== undefined) {
            item.y = j.y;
          }
          if (j.w !== undefined) {
            item.w = j.w;
          }
          if (j.h !== undefined) {
            item.h = j.h;
          }
          item.locked = j.locked === true;
          doc.items.push(item);
        }
      }
      if (d.filters !== undefined) {
        for (let k = 0; k < d.filters.length; k++) {
          const jf = d.filters[k];
          const f = new DashboardFilter(jf.field, jf.kind);
          f.id = jf.id !== undefined ? jf.id : 'flt_' + Date.now().toString() + '_' + k.toString();
          f.values = jf.values !== undefined ? jf.values : [];
          f.lo = jf.lo !== undefined ? jf.lo : '';
          f.hi = jf.hi !== undefined ? jf.hi : '';
          doc.filters.push(f);
        }
      }
      this.dashboards.push(doc);
    }
    if (this.dashboards.length === 0) {
      this.ensureDefault();
      return;
    }
    const target = this.findDoc(activeId) !== null ? activeId : this.dashboards[0].id;
    const doc = this.findDoc(target) as DashboardDoc;
    this.activeId = doc.id;
    this.items = doc.items;
    this.filters = doc.filters;
    this.undoStack = [];
    this.redoStack = [];
    this.bump();
  }

  /** Init single empty dashboard (constructor-time / after import fallback). */
  ensureDefault(name: string = 'Dashboard 1'): void {
    if (this.dashboards.length === 0) {
      const doc = new DashboardDoc('dashb_' + Date.now().toString(), name);
      doc.items = this.items;
      doc.filters = this.filters;
      this.dashboards.push(doc);
      this.activeId = doc.id;
    } else if (this.findDoc(this.activeId) === null) {
      this.activeId = this.dashboards[0].id;
      this.items = this.dashboards[0].items;
      this.filters = this.dashboards[0].filters;
    }
  }

  createDashboard(): DashboardDoc {
    const doc = new DashboardDoc('dashb_' + Date.now().toString(),
      'Dashboard ' + (this.dashboards.length + 1).toString());
    this.dashboards.push(doc);
    this.switchDashboard(doc.id);
    this.bump();
    return doc;
  }

  renameDashboard(id: string, name: string): void {
    const doc = this.findDoc(id);
    if (doc !== null && name.trim().length > 0) {
      doc.name = name.trim();
      doc.updatedAt = new Date().toISOString();
      this.bump();
    }
  }

  duplicateDashboard(id: string): void {
    const src = this.findDoc(id);
    if (src === null) {
      return;
    }
    const idx = this.dashboards.indexOf(src);
    const doc = new DashboardDoc('dashb_' + Date.now().toString(), src.name + ' copy');
    doc.items = copyItems(src.items);
    doc.filters = copyFilters(src.filters);
    this.dashboards.splice(idx + 1, 0, doc);
    this.switchDashboard(doc.id);
    this.bump();
  }

  deleteDashboard(id: string): void {
    const doc = this.findDoc(id);
    if (doc === null) {
      return;
    }
    const idx = this.dashboards.indexOf(doc);
    this.dashboards.splice(idx, 1);
    if (this.dashboards.length === 0) {
      const fresh = new DashboardDoc('dashb_' + Date.now().toString(), 'Dashboard 1');
      this.dashboards.push(fresh);
    }
    if (this.activeId === id || this.findDoc(this.activeId) === null) {
      this.switchDashboard(this.dashboards[Math.max(0, idx - 1)].id);
    }
    this.bump();
  }

  switchDashboard(id: string): void {
    const doc = this.findDoc(id);
    if (doc === null || id === this.activeId) {
      return;
    }
    this.syncActiveDoc();
    this.activeId = id;
    this.items = doc.items;
    this.filters = doc.filters;
    this.undoStack = [];
    this.redoStack = [];
    this.bump();
  }

  // ---- layout templates (web Save layout / 选择布局… / 删除布局模板) ----

  loadLayoutTemplates(): void {
    try {
      const raw = Settings.loadDashTemplates();
      if (raw.length > 0) {
        this.layoutTemplates = JSON.parse(raw) as LayoutTemplateDoc[];
      }
    } catch (e) {
      this.layoutTemplates = [];
    }
  }

  private persistLayoutTemplates(): void {
    Settings.saveDashTemplates(JSON.stringify(this.layoutTemplates));
  }

  saveLayoutTemplate(): void {
    const entries: LayoutEntryJson[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const s = this.items[i];
      entries.push({ chartId: s.chartId.length > 0 ? s.chartId : s.id, x: s.x, y: s.y, w: s.w, h: s.h });
    }
    this.layoutTemplates.unshift(new LayoutTemplateDoc('lay_' + Date.now().toString(),
      '布局 ' + (this.layoutTemplates.length + 1).toString(), JSON.stringify(entries)));
    this.persistLayoutTemplates();
    this.bump();
  }

  applyLayoutTemplate(id: string): boolean {
    let tpl: LayoutTemplateDoc | null = null;
    for (let i = 0; i < this.layoutTemplates.length; i++) {
      if (this.layoutTemplates[i].id === id) {
        tpl = this.layoutTemplates[i];
        break;
      }
    }
    if (tpl === null) {
      return false;
    }
    try {
      const entries = JSON.parse(tpl.layout) as LayoutEntryJson[];
      this.record();
      for (let e = 0; e < entries.length; e++) {
        const entry = entries[e];
        for (let i = 0; i < this.items.length; i++) {
          const item = this.items[i];
          const key = item.chartId.length > 0 ? item.chartId : item.id;
          if (key === entry.chartId) {
            item.x = entry.x;
            item.y = entry.y;
            item.w = entry.w;
            item.h = entry.h;
            break;
          }
        }
      }
      this.compact();
      this.bump();
      return true;
    } catch (err) {
      return false;
    }
  }

  deleteLayoutTemplate(id: string): void {
    const next: LayoutTemplateDoc[] = [];
    for (let i = 0; i < this.layoutTemplates.length; i++) {
      if (this.layoutTemplates[i].id !== id) {
        next.push(this.layoutTemplates[i]);
      }
    }
    this.layoutTemplates = next;
    this.persistLayoutTemplates();
    this.bump();
  }

  findItem(id: string): DashboardItem | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) {
        return this.items[i];
      }
    }
    return null;
  }

  // ---- snapshots (web __recordAndApply; move/resize excluded) ----

  private snapshotJson(): string {
    const snap: DashSnapshotJson = { items: copyItems(this.items), filters: copyFilters(this.filters) };
    return JSON.stringify(snap);
  }

  private restoreJson(json: string): boolean {
    try {
      const snap = JSON.parse(json) as DashSnapshotJson;
      this.items = copyItems(snap.items as object[] as DashboardItem[]);
      this.filters = copyFilters(snap.filters as object[] as DashboardFilter[]);
      this.bump();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Record a snapshot before a stack-worthy mutation (cap 50, clear redo). */
  record(): void {
    this.undoStack.push(this.snapshotJson());
    if (this.undoStack.length > 50) {
      this.undoStack = this.undoStack.slice(this.undoStack.length - 50);
    }
    this.redoStack = [];
  }

  undo(): boolean {
    if (this.undoStack.length === 0) {
      return false;
    }
    this.redoStack.push(this.snapshotJson());
    const prev = this.undoStack.pop();
    if (prev === undefined) {
      return false;
    }
    return this.restoreJson(prev);
  }

  redo(): boolean {
    if (this.redoStack.length === 0) {
      return false;
    }
    this.undoStack.push(this.snapshotJson());
    const next = this.redoStack.pop();
    if (next === undefined) {
      return false;
    }
    return this.restoreJson(next);
  }

  // ---- items ----

  /** First free placement scanning top-down/left-right (RGL compaction). */
  private freePosition(w: number, h: number): number[] {
    const taken = this.items.slice();
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x + w <= DASH_COLS; x++) {
        if (!this.collides(x, y, w, h, taken, '')) {
          return [x, y];
        }
      }
    }
    return [0, 0];
  }

  private collides(x: number, y: number, w: number, h: number, items: DashboardItem[], exceptId: string): boolean {
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (o.id === exceptId) {
        continue;
      }
      if (x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h) {
        return true;
      }
    }
    return false;
  }

  private addPlaced(item: DashboardItem): DashboardItem {
    const pos = this.freePosition(item.w, item.h);
    item.x = pos[0];
    item.y = pos[1];
    this.items.push(item);
    this.compact();
    this.bump();
    return item;
  }

  addChart(chartId: string): DashboardItem {
    this.record();
    return this.addPlaced(new DashboardItem(DashboardItemKind.Chart, chartId));
  }

  addKpi(column: string, agg: string, label: string): DashboardItem {
    this.record();
    return this.addPlaced(new DashboardItem(DashboardItemKind.Kpi, '', label, column, agg));
  }

  addText(text: string): DashboardItem {
    this.record();
    return this.addPlaced(new DashboardItem(DashboardItemKind.Text, '', '', '', 'sum', text));
  }

  updateText(id: string, text: string): void {
    const item = this.findItem(id);
    if (item !== null) {
      this.record();
      item.text = text;
      this.bump();
    }
  }

  removeItem(id: string): void {
    this.record();
    const next: DashboardItem[] = [];
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id !== id) {
        next.push(this.items[i]);
      }
    }
    this.items = next;
    this.compact();
    this.bump();
  }

  hasChartItem(chartId: string): boolean {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].kind === DashboardItemKind.Chart && this.items[i].chartId === chartId) {
        return true;
      }
    }
    return false;
  }

  // ---- layout ops (move/resize stay out of the undo stack) ----

  /** Commit a dragged position, resolve overlaps downward, compact. */
  moveItem(id: string, x: number, y: number): void {
    const item = this.findItem(id);
    if (item === null || item.locked) {
      return;
    }
    item.x = Math.max(0, Math.min(x, DASH_COLS - item.w));
    item.y = Math.max(0, y);
    this.resolveOverlaps(item.id);
    this.compact();
    this.bump();
  }

  resizeItem(id: string, w: number, h: number): void {
    const item = this.findItem(id);
    if (item === null || item.locked) {
      return;
    }
    item.w = Math.max(DASH_MIN_W, Math.min(w, DASH_COLS - item.x));
    item.h = Math.max(DASH_MIN_H, h);
    this.resolveOverlaps(item.id);
    this.compact();
    this.bump();
  }

  /** Push items that collide with `id` (or each other) downwards. */
  private resolveOverlaps(movedId: string): void {
    const sorted = this.items.slice().sort((a: DashboardItem, b: DashboardItem) =>
      (a.y - b.y) !== 0 ? (a.y - b.y) : (a.x - b.x));
    for (let pass = 0; pass < 4; pass++) {
      let movedAny = false;
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i];
        for (let j = 0; j < i; j++) {
          const other = sorted[j];
          if (cur.x < other.x + other.w && other.x < cur.x + cur.w
            && cur.y < other.y + other.h && other.y < cur.y + cur.h) {
            cur.y = other.y + other.h;
            movedAny = true;
          }
        }
      }
      if (!movedAny) {
        break;
      }
    }
  }

  /** Vertical compaction: pull every item up (web RGL verticalCompact). */
  compact(): void {
    const sorted = this.items.slice().sort((a: DashboardItem, b: DashboardItem) =>
      (a.y - b.y) !== 0 ? (a.y - b.y) : (a.x - b.x));
    const placed: DashboardItem[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      let y = 0;
      let moved = true;
      while (moved) {
        moved = false;
        for (let j = 0; j < placed.length; j++) {
          const o = placed[j];
          if (cur.x < o.x + o.w && o.x < cur.x + cur.w && y < o.y + o.h && o.y < y + cur.h) {
            y = o.y + o.h;
            moved = true;
          }
        }
      }
      cur.y = y;
      placed.push(cur);
    }
  }

  /** Align unlocked items to the smallest x (left) or y (top). */
  alignItems(axis: 'x' | 'y'): void {
    this.record();
    let min = Number.MAX_VALUE;
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].locked) {
        min = Math.min(min, axis === 'x' ? this.items[i].x : this.items[i].y);
      }
    }
    if (min === Number.MAX_VALUE) {
      return;
    }
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].locked) {
        if (axis === 'x') {
          this.items[i].x = min;
        } else {
          this.items[i].y = min;
        }
      }
    }
    this.resolveOverlaps('');
    this.compact();
    this.bump();
  }

  /** Even spacing across unlocked items (needs >= 3, web spaceItemsEvenly). */
  spaceItemsEvenly(axis: 'x' | 'y'): void {
    const list: DashboardItem[] = [];
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].locked) {
        list.push(this.items[i]);
      }
    }
    if (list.length < 3) {
      return;
    }
    this.record();
    list.sort((a: DashboardItem, b: DashboardItem) => axis === 'x' ? a.x - b.x : a.y - b.y);
    const first = list[0];
    const last = list[list.length - 1];
    const firstVal = axis === 'x' ? first.x : first.y;
    const lastVal = axis === 'x' ? last.x : last.y;
    const step = (lastVal - firstVal) / (list.length - 1);
    for (let i = 1; i < list.length - 1; i++) {
      const target = Math.round(firstVal + step * i);
      if (axis === 'x') {
        list[i].x = Math.max(0, Math.min(target, DASH_COLS - list[i].w));
      } else {
        list[i].y = target;
      }
    }
    this.resolveOverlaps('');
    this.compact();
    this.bump();
  }

  toggleLock(id: string): void {
    const item = this.findItem(id);
    if (item !== null) {
      item.locked = !item.locked;
      this.bump();
    }
  }

  setEditMode(on: boolean): void {
    this.editMode = on;
    this.bump();
  }

  // ---- filters ----

  addFilter(field: string, kind: string): void {
    this.record();
    this.filters.push(new DashboardFilter(field, kind));
    this.bump();
  }

  removeFilter(id: string): void {
    this.record();
    const next: DashboardFilter[] = [];
    for (let i = 0; i < this.filters.length; i++) {
      if (this.filters[i].id !== id) {
        next.push(this.filters[i]);
      }
    }
    this.filters = next;
    this.bump();
  }

  clearFilters(): void {
    this.record();
    this.filters = [];
    this.bump();
  }

  toggleFilterValue(id: string, value: string): void {
    const f = this.findFilter(id);
    if (f === null) {
      return;
    }
    const idx = f.values.indexOf(value);
    if (idx >= 0) {
      f.values.splice(idx, 1);
    } else {
      f.values.push(value);
    }
    this.bump();
  }

  setFilterRange(id: string, lo: string, hi: string): void {
    const f = this.findFilter(id);
    if (f !== null) {
      f.lo = lo;
      f.hi = hi;
      this.bump();
    }
  }

  findFilter(id: string): DashboardFilter | null {
    for (let i = 0; i < this.filters.length; i++) {
      if (this.filters[i].id === id) {
        return this.filters[i];
      }
    }
    return null;
  }

  hasActiveFilters(): boolean {
    return this.activeFilterCount() > 0;
  }

  /** Number of currently effective filters (web dashboardFiltersForDataset). */
  activeFilterCount(): number {
    let n = 0;
    for (let i = 0; i < this.filters.length; i++) {
      const f = this.filters[i];
      if (f.kind === 'category' && f.values.length > 0) {
        n++;
      }
      if (f.kind !== 'category' && (f.lo.length > 0 || f.hi.length > 0)) {
        n++;
      }
    }
    return n;
  }

  /** Bump the tick and mirror it to AppStorage so @StorageLink watchers fire. */
  bump(): void {
    this.syncActiveDoc();
    this.tick++;
    AppStorage.setOrCreate('dashboardTick', this.tick);
  }
}

/**
 * Apply the dashboard filters to a frame (web _filter_by_filters semantics):
 * category = stringified 'in'; range tries numeric bounds first, falls back
 * to datetime compare; a 10-char upper bound means "whole day" (exclusive +1d).
 */
export function applyDashboardFilters(df: DataFrame, filters: DashboardFilter[]): DataFrame {
  let rows: CellValue[][] = df.rows;
  let mutated = false;
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    const idx = df.columnIndex(f.field);
    if (idx < 0) {
      continue;
    }
    if (f.kind === 'category') {
      if (f.values.length === 0) {
        continue;
      }
      const set = new Set<string>();
      for (let k = 0; k < f.values.length; k++) {
        set.add(f.values[k]);
      }
      const kept: CellValue[][] = [];
      for (let r = 0; r < rows.length; r++) {
        if (set.has(String(rows[r][idx]))) {
          kept.push(rows[r]);
        }
      }
      rows = kept;
      mutated = true;
    } else {
      const loEmpty = f.lo.length === 0;
      const hiEmpty = f.hi.length === 0;
      if (loEmpty && hiEmpty) {
        continue;
      }
      const loN = loEmpty ? NaN : Number(f.lo);
      const hiN = hiEmpty ? NaN : Number(f.hi);
      const loNumOk = !loEmpty && !Number.isNaN(loN);
      const hiNumOk = !hiEmpty && !Number.isNaN(hiN);
      // whole-day upper bound (exclusive +1d) for 10-char dates
      let hiDayMs = NaN;
      if (!hiEmpty && f.hi.length === 10 && !hiNumOk) {
        const t = Date.parse(f.hi);
        if (!Number.isNaN(t)) {
          hiDayMs = t + 86400000;
        }
      }
      const loS = f.lo;
      const hiS = f.hi;
      const kept: CellValue[][] = [];
      for (let r = 0; r < rows.length; r++) {
        const v = rows[r][idx];
        if (v === null || v === undefined) {
          continue;
        }
        const n = toNumber(v);
        if (n !== null && (loNumOk || hiNumOk)) {
          if (loNumOk && n < loN) {
            continue;
          }
          if (hiNumOk && n > hiN) {
            continue;
          }
          kept.push(rows[r]);
          continue;
        }
        const s = String(v);
        if (!loEmpty && s < loS) {
          continue;
        }
        if (!hiEmpty) {
          if (!Number.isNaN(hiDayMs)) {
            const t = Date.parse(s);
            if (Number.isNaN(t) || t >= hiDayMs) {
              continue;
            }
          } else if (s > hiS) {
            continue;
          }
        }
        kept.push(rows[r]);
      }
      rows = kept;
      mutated = true;
    }
  }
  if (!mutated) {
    return df;
  }
  const out = new DataFrame(df.name, df.columns, rows);
  return out;
}

/** KPI display format (web KpiCard formatValue): —/x.xM/x.xK/int/2dp. */
export function formatKpiValue(v: number | null): string {
  if (v === null) {
    return '—';
  }
  const abs = Math.abs(v);
  if (abs >= 1e6) {
    return trim1(v / 1e6) + 'M';
  }
  if (abs >= 1e4) {
    return trim1(v / 1e4) + 'K';
  }
  if (Number.isInteger(v)) {
    return String(v);
  }
  return v.toFixed(2);
}

function trim1(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}
