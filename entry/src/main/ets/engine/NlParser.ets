import { DataFrame } from '../model/DataFrame';
import { toNumber } from './Numeric';

/**
 * Local natural-language parser (web: backend/api/nl.py nl_transform, which
 * relies on an LLM). Heuristic rules translate a Chinese/English phrase into a
 * chain of transform operations ({type, params}) covering the web operator
 * set: filter/sort/dropna/fillna/rename/dtype/compute/pivot/melt/dedupe/clip/
 * parse_numeric. Deterministic and offline.
 */
export class NlOp {
  type: string;
  params: string;

  constructor(type: string, params: string) {
    this.type = type;
    this.params = params;
  }
}

export interface NlFilterParams {
  column: string;
  operator: string;
  value: string;
}
export interface NlRenameParams {
  oldName: string;
  newName: string;
}
export interface NlClipParams {
  column: string;
  min?: number;
  max?: number;
}

export function parseNlOps(df: DataFrame, query: string): NlOp[] {
  const q = query.toLowerCase();
  const cols = df.columns.map((c) => c.name);
  const ops: NlOp[] = [];

  // 1. 去重 / dedupe
  if (hasKw(q, ['去重', '重复行', 'dedupe', 'duplicate'])) {
    ops.push(new NlOp('dedupe', JSON.stringify({ columns: null })));
  }

  // 2. 缺失行 / dropna
  if (hasKw(q, ['缺失', '空值行', '删除空', 'dropna', 'drop null', 'drop missing'])) {
    ops.push(new NlOp('dropNa', JSON.stringify({ columns: null })));
  }

  // 3. 填充缺失 / fillna
  const fillVal = matchNumber(q, ['填充为', '填充', 'fill with', 'fillna']);
  const firstCol = firstMatchingColumn(q, cols);
  if (fillVal !== null && firstCol !== null) {
    ops.push(new NlOp('fillMissing', JSON.stringify({ column: firstCol, value: String(fillVal) })));
  } else if (hasKw(q, ['填充', 'fillna', 'fill missing'])) {
    ops.push(new NlOp('fillMissing', JSON.stringify({ column: firstNumericColumn(df), value: '0' })));
  }

  // 4. filter: 列 + 比较/包含 + 值
  const f = parseFilter(q, cols);
  if (f !== null) {
    ops.push(new NlOp('filter', JSON.stringify(f)));
  }

  // 5. sort
  if (hasKw(q, ['排序', 'sort'])) {
    const col = firstMatchingColumn(q, cols);
    if (col !== null) {
      const asc = !hasKw(q, ['降序', 'descending', 'desc']);
      ops.push(new NlOp('sort', JSON.stringify({ column: col, ascending: asc })));
    }
  }

  // 6. rename
  const r = parseRename(q, cols);
  if (r !== null) {
    ops.push(new NlOp('rename', JSON.stringify(r)));
  }

  // 7. dtype / parse_numeric
  if (hasKw(q, ['转数值', '变成数字', '数值化', 'parse numeric', 'to number'])) {
    const col = firstMatchingColumn(q, cols);
    if (col !== null) {
      ops.push(new NlOp('parse_numeric', JSON.stringify({ column: col })));
    }
  }

  // 8. clip: 裁剪数值
  const clipMin = matchNumber(q, ['不小于', '至少', '至少为', 'min']);
  const clipMax = matchNumber(q, ['不大于', '最多', '最多为', 'max']);
  const numericCol = firstNumericColumn(df);
  if ((clipMin !== null || clipMax !== null) && numericCol !== null) {
    const params: NlClipParams = { column: numericCol };
    if (clipMin !== null) {
      params.min = clipMin;
    }
    if (clipMax !== null) {
      params.max = clipMax;
    }
    ops.push(new NlOp('clip', JSON.stringify(params)));
  }

  // 9. compute: 计算列（新列 = 某列的 abs/负/平方等）
  const computeName = matchName(q, ['计算列', '新增列', '新列', 'compute']);
  if (computeName !== null) {
    const src = firstNumericColumn(df);
    if (src !== null) {
      let opName = 'copy';
      if (hasKw(q, ['绝对值', 'abs'])) {
        opName = 'abs';
      } else if (hasKw(q, ['平方', 'square'])) {
        opName = 'square';
      } else if (hasKw(q, ['负', 'neg'])) {
        opName = 'neg';
      }
      ops.push(new NlOp('compute', JSON.stringify({ name: computeName, sourceColumn: src, operation: opName })));
    }
  }

  // 10. pivot: 透视
  if (hasKw(q, ['透视', 'pivot', '交叉表'])) {
    if (cols.length >= 2) {
      const index = firstMatchingColumn(q, cols) ?? cols[0];
      const others = cols.filter((c) => c !== index);
      ops.push(new NlOp('pivot', JSON.stringify({
        index: index,
        columns: others[0],
        values: firstNumericColumn(df) ?? others[others.length - 1],
        agg: hasKw(q, ['均值', 'mean']) ? 'mean' : 'sum',
      })));
    }
  }

  // 11. melt: 宽转长
  if (hasKw(q, ['宽转长', 'melt', '拆列'])) {
    const idVar = firstMatchingColumn(q, cols);
    if (idVar !== null) {
      ops.push(new NlOp('melt', JSON.stringify({ idVars: [idVar] })));
    } else if (cols.length > 0) {
      ops.push(new NlOp('melt', JSON.stringify({ idVars: [cols[0]] })));
    }
  }

  return ops;
}

function hasKw(q: string, kws: string[]): boolean {
  for (let i = 0; i < kws.length; i++) {
    if (q.indexOf(kws[i]) >= 0) {
      return true;
    }
  }
  return false;
}

function firstMatchingColumn(q: string, cols: string[]): string | null {
  for (let i = 0; i < cols.length; i++) {
    if (q.indexOf(cols[i].toLowerCase()) >= 0) {
      return cols[i];
    }
  }
  return null;
}

function firstNumericColumn(df: DataFrame): string | null {
  for (let i = 0; i < df.columns.length; i++) {
    if (df.columns[i].dtype === 'number') {
      return df.columns[i].name;
    }
  }
  return null;
}

/** Extract a number that follows one of the trigger keywords. */
function matchNumber(q: string, triggers: string[]): number | null {
  for (let i = 0; i < triggers.length; i++) {
    const idx = q.indexOf(triggers[i]);
    if (idx >= 0) {
      const rest = q.substring(idx + triggers[i].length);
      const m = rest.match(/-?\d+(\.\d+)?/);
      if (m !== null) {
        const n = parseFloat(m[0]);
        if (!Number.isNaN(n)) {
          return n;
        }
      }
    }
  }
  return null;
}

/** Extract the new column name after "计算列/新增列 …" style phrases. */
function matchName(q: string, triggers: string[]): string | null {
  for (let i = 0; i < triggers.length; i++) {
    const idx = q.indexOf(triggers[i]);
    if (idx >= 0) {
      const rest = q.substring(idx + triggers[i].length).trim();
      const m = rest.match(/[a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*/);
      if (m !== null) {
        return m[0];
      }
    }
  }
  return null;
}

/** filter: [column] [operator] [value] patterns. */
function parseFilter(q: string, cols: string[]): NlFilterParams | null {
  const col = firstMatchingColumn(q, cols);
  if (col === null) {
    return null;
  }
  let operator = 'eq';
  if (hasKw(q, ['大于等于', '>='])) {
    operator = 'gte';
  } else if (hasKw(q, ['小于等于', '<='])) {
    operator = 'lte';
  } else if (hasKw(q, ['大于', '>'])) {
    operator = 'gt';
  } else if (hasKw(q, ['小于', '<'])) {
    operator = 'lt';
  } else if (hasKw(q, ['不等于', '!='])) {
    operator = 'ne';
  } else if (hasKw(q, ['包含', 'contains'])) {
    operator = 'contains';
  } else if (hasKw(q, ['等于', '='])) {
    operator = 'eq';
  }
  if (!hasKw(q, ['筛选', '过滤', 'filter', 'where'])) {
    return null;
  }
  const m = q.match(/-?\d+(\.\d+)?/);
  if (m === null) {
    return null;
  }
  const r: NlFilterParams = { column: col, operator: operator, value: m[0] };
  return r;
}

/** rename: 把/将 A 重命名为 B (A → B / rename A to B). */
function parseRename(q: string, cols: string[]): NlRenameParams | null {
  const col = firstMatchingColumn(q, cols);
  if (col === null) {
    return null;
  }
  if (!hasKw(q, ['重命名', '改名', 'rename'])) {
    return null;
  }
  // find target after 为/成/to
  const rest = q.substring(q.indexOf(col.toLowerCase()) + col.length);
  const m = rest.match(/[a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*/);
  if (m === null) {
    return null;
  }
  const r: NlRenameParams = { oldName: col, newName: m[0] };
  return r;
}
