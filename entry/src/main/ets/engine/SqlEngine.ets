import { relationalStore } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { CellValue, ColumnMeta, DataFrame } from '../model/DataFrame';
import { inferDtype, fieldTypeFor } from './InferType';

/**
 * Local SQL workbench engine (web: backend/core/query_engine.py). Datasets are
 * mirrored into a SQLite database via the system relationalStore — the same
 * engine family as the web backend's in-memory sqlite3, so the SQL dialect
 * matches. Read-only single-SELECT validation mirrors web rules.
 */
const MAX_ROWS = 10000;
const INSERT_BATCH = 400;
const DB_NAME = 'sql_workbench.db';
const FORBIDDEN: RegExp = /\b(attach|detach|pragma|create|drop|alter|insert|update|delete|replace|vacuum|reindex)\b/i;

export class SqlQueryResult {
  ok: boolean = false;
  error: string = '';
  columns: string[] = [];
  rows: CellValue[][] = [];
  elapsedMs: number = 0;
  truncated: boolean = false;
}

/** Table name rule mirrored from web safe_table_name (index keeps it unique). */
export function safeTableName(index: number, name: string): string {
  const base = name.replace(/[^0-9A-Za-z_\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '');
  const trimmed = base.length > 0 ? base.substring(0, 40) : 'data';
  return trimmed + '_' + (index + 1).toString();
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function validateSelect(sql: string): string {
  const stripped = sql.trim().replace(/;+\s*$/, '').trim();
  if (stripped.length === 0) {
    return 'empty';
  }
  if (stripped.indexOf(';') >= 0) {
    return '仅允许单条语句';
  }
  if (!/^select\s/i.test(stripped)) {
    return '仅支持只读 SELECT';
  }
  if (FORBIDDEN.test(stripped)) {
    return '包含禁止的关键词';
  }
  return '';
}

function getStore(context: common.Context): Promise<relationalStore.RdbStore> {
  const config: relationalStore.StoreConfig = {
    name: DB_NAME,
    securityLevel: relationalStore.SecurityLevel.S1,
  };
  return relationalStore.getRdbStore(context, config);
}

/** Mirror every dataset into its own table (web: pandas to_sql per dataset). */
export async function mirrorDatasets(context: common.Context, dataFrames: DataFrame[]): Promise<boolean> {
  try {
    const store = await getStore(context);

    // Clean slate: drop every existing table (web rebuilds :memory: per connection).
    const rs = await store.querySql("SELECT name FROM sqlite_master WHERE type='table'");
    const existing: string[] = [];
    if (rs.goToFirstRow()) {
      do {
        const idx = rs.columnNames.indexOf('name');
        if (idx >= 0) {
          existing.push(rs.getString(idx));
        }
      } while (rs.goToNextRow());
    }
    rs.close();
    for (let i = 0; i < existing.length; i++) {
      await store.executeSql('DROP TABLE IF EXISTS ' + quoteIdent(existing[i]));
    }

    for (let d = 0; d < dataFrames.length; d++) {
      const df = dataFrames[d];
      const table = safeTableName(d, df.name);
      const colDefs: string[] = [];
      for (let c = 0; c < df.columns.length; c++) {
        const sqlType = df.columns[c].dtype === 'number' ? 'DOUBLE' : 'TEXT';
        colDefs.push(quoteIdent(df.columns[c].name) + ' ' + sqlType);
      }
      await store.executeSql('CREATE TABLE ' + quoteIdent(table) + ' (' + colDefs.join(', ') + ')');

      let batch: relationalStore.ValuesBucket[] = [];
      for (let r = 0; r < df.rows.length; r++) {
        const vb: relationalStore.ValuesBucket = {};
        for (let c = 0; c < df.columns.length; c++) {
          const v = df.rows[r][c];
          if (v === null || v === undefined) {
            vb[df.columns[c].name] = null;
          } else if (df.columns[c].dtype === 'boolean') {
            vb[df.columns[c].name] = v === true ? 1 : 0;
          } else if (df.columns[c].dtype === 'number') {
            vb[df.columns[c].name] = typeof v === 'number' ? v : Number(v);
          } else {
            vb[df.columns[c].name] = String(v);
          }
        }
        batch.push(vb);
        if (batch.length >= INSERT_BATCH) {
          await store.batchInsert(table, batch);
          batch = [];
        }
      }
      if (batch.length > 0) {
        await store.batchInsert(table, batch);
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

/** Run one validated read-only SELECT and fetch up to MAX_ROWS (web rules). */
export async function runQuery(context: common.Context, sql: string): Promise<SqlQueryResult> {
  const out = new SqlQueryResult();
  const err = validateSelect(sql);
  if (err.length > 0) {
    out.error = err;
    return out;
  }
  const start = Date.now();
  let rs: relationalStore.ResultSet | null = null;
  try {
    const store = await getStore(context);
    rs = await store.querySql(sql);
    out.columns = rs.columnNames.slice();
    if (rs.goToFirstRow()) {
      do {
        const row: CellValue[] = [];
        for (let c = 0; c < out.columns.length; c++) {
          const t = rs.getColumnTypeSync(c);
          if (t === relationalStore.ColumnType.INTEGER) {
            row.push(rs.getLong(c));
          } else if (t === relationalStore.ColumnType.REAL) {
            row.push(rs.getDouble(c));
          } else if (t === relationalStore.ColumnType.TEXT) {
            row.push(rs.getString(c));
          } else {
            row.push(null);
          }
        }
        out.rows.push(row);
      } while (out.rows.length < MAX_ROWS && rs.goToNextRow());
    }
    out.truncated = rs.rowCount > out.rows.length;
    out.ok = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (rs !== null) {
      try {
        rs.close();
      } catch (e) {
        // already closed
      }
    }
  }
  out.elapsedMs = Date.now() - start;
  return out;
}

/** Convert a result grid into a dataset (web: /sql/workbench/import-result). */
export function resultToDataFrame(columns: string[], rows: CellValue[][], name: string): DataFrame {
  const metas: ColumnMeta[] = [];
  for (let c = 0; c < columns.length; c++) {
    const col: CellValue[] = [];
    for (let r = 0; r < rows.length; r++) {
      col.push(rows[r][c]);
    }
    const dtype = inferDtype(col);
    metas.push(new ColumnMeta(columns[c], dtype, fieldTypeFor(dtype), false));
  }
  return new DataFrame(name, metas, rows);
}
