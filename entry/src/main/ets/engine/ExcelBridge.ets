import { CellValue, ColumnMeta, DataFrame } from '../model/DataFrame';
import { inferDtype, fieldTypeFor } from './InferType';

/**
 * Excel import helpers (web: backend pandas read_excel). The actual parsing
 * happens in rawfile/xlsx_bridge.html via SheetJS inside a hidden WebView;
 * this module decodes the bridge reply and converts the row matrix into a
 * DataFrame with the same type inference as the CSV parser.
 */

/** Shape of the JSON reply produced by xlsx_bridge.html. */
interface XlsxReply {
  ok?: boolean;
  error?: string;
  sheetNames?: string[];
  sheet?: string;
  rows?: CellValue[][];
}

export class SheetParse {
  ok: boolean = false;
  error: string = '';
  sheetNames: string[] = [];
  sheet: string = '';
  rows: CellValue[][] = []; // first row = header

  static failed(error: string): SheetParse {
    const out = new SheetParse();
    out.error = error;
    return out;
  }
}

/**
 * Decode the runJavaScript reply. Defends against double-JSON-encoding of the
 * bridge string depending on the WebView promise serialization.
 */
export function parseXlsxReply(reply: string): SheetParse {
  let text = reply;
  try {
    // Double-encoded replies arrive as a JSON string wrapping the JSON object.
    const outer = JSON.parse(text) as string;
    if (typeof outer === 'string') {
      text = outer;
    }
  } catch (e) {
    // not double encoded — continue
  }
  try {
    const data = JSON.parse(text) as XlsxReply;
    const out = new SheetParse();
    out.ok = data.ok === true;
    out.error = data.error !== undefined ? data.error : '';
    out.sheet = data.sheet !== undefined ? data.sheet : '';
    if (data.sheetNames !== undefined) {
      out.sheetNames = data.sheetNames;
    }
    if (data.rows !== undefined) {
      out.rows = data.rows;
    }
    if (!out.ok && out.error.length === 0) {
      out.error = 'unknown bridge error';
    }
    return out;
  } catch (e) {
    return SheetParse.failed('bridge reply is not JSON');
  }
}

/** Convert a header-first row matrix into a typed DataFrame (like parseCsvText). */
export function matrixToDataFrame(name: string, rows: CellValue[][]): DataFrame | null {
  if (rows.length === 0) {
    return null;
  }
  const headerRow = rows[0];
  const width = headerRow.length;
  if (width === 0) {
    return null;
  }
  const header: string[] = [];
  const seen = new Set<string>();
  for (let c = 0; c < width; c++) {
    const raw = headerRow[c];
    let colName = raw === null || raw === undefined || String(raw).trim().length === 0
      ? 'col' + (c + 1).toString()
      : String(raw).trim();
    let unique = colName;
    let suffix = 2;
    while (seen.has(unique)) {
      unique = colName + '_' + suffix.toString();
      suffix++;
    }
    seen.add(unique);
    header.push(unique);
  }

  const columnsVals: CellValue[][] = [];
  for (let c = 0; c < width; c++) {
    columnsVals.push([]);
  }
  const outRows: CellValue[][] = [];
  for (let r = 1; r < rows.length; r++) {
    const src = rows[r];
    let hasValue = false;
    const row: CellValue[] = [];
    for (let c = 0; c < width; c++) {
      const v = c < src.length ? src[c] : null;
      if (v !== null && v !== undefined) {
        hasValue = true;
      }
      row.push(v);
      columnsVals[c].push(v);
    }
    if (hasValue) {
      outRows.push(row); // skip fully-empty sheet rows
    }
  }

  const metas: ColumnMeta[] = [];
  for (let c = 0; c < width; c++) {
    const dtype = inferDtype(columnsVals[c]);
    metas.push(new ColumnMeta(header[c], dtype, fieldTypeFor(dtype), false));
  }
  return new DataFrame(name, metas, outRows);
}
