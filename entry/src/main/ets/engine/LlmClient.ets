import { http } from '@kit.NetworkKit';
import { LlmConfig } from '../model/WorkspaceState';
import { DataFrame, TransformOp } from '../model/DataFrame';
import {
  ClipParams, ComputeParams, DedupeParams, FillMissingParams, FilterParams,
  MeltParams, PivotParams, RenameParams, SortParams
} from './TransformOps';

/** Chat message for the OpenAI-compatible /chat/completions payload. */
export interface ChatMessage {
  role: string;
  content: string;
}

interface ChatChoiceMessage {
  content?: string;
}
interface ChatChoice {
  message: ChatChoiceMessage;
}
interface ChatCompletionBody {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number;
}
interface ChatCompletionResponse {
  choices?: ChatChoice[];
}
interface SingleColumnParams {
  column: string;
}

/** LLM op params as produced by the model (all fields optional until validated). */
interface LlmOpParams {
  column?: string;
  columns?: string;
  operator?: string;
  value?: string;
  ascending?: boolean;
  oldName?: string;
  newName?: string;
  min?: number;
  max?: number;
  name?: string;
  sourceColumn?: string;
  operation?: string;
  index?: string;
  values?: string;
  agg?: string;
  idVars?: string[];
}
interface LlmOp {
  type?: string;
  params?: LlmOpParams;
}

/** Ops the LLM may emit — the same set the local NlParser supports. */
const LLM_OP_TYPES: string[] = ['dedupe', 'dropNa', 'fillMissing', 'filter', 'sort', 'rename',
  'parse_numeric', 'clip', 'compute', 'pivot', 'melt'];

const OPS_SYSTEM_PROMPT: string = '你是数据清洗操作解析器。把用户的中文或英文指令转换为清洗操作 JSON 数组。' +
  '只输出 JSON 数组，不要输出任何解释。\n' +
  '可用操作（type: params 字段）:\n' +
  '- dedupe: {}\n' +
  '- dropNa: {}\n' +
  '- fillMissing: {column, value}\n' +
  '- filter: {column, operator(eq|ne|gt|gte|lt|lte|contains), value}\n' +
  '- sort: {column, ascending}\n' +
  '- rename: {oldName, newName}\n' +
  '- parse_numeric: {column}\n' +
  '- clip: {column, min, max}\n' +
  '- compute: {name, sourceColumn, operation(abs|neg|sqrt|square)}\n' +
  '- pivot: {index, columns, values, agg(sum|mean|count|min|max)}\n' +
  '- melt: {idVars}\n' +
  'column 必须使用数据摘要中给出的真实列名。无法解析时输出 []。';

const ASK_SYSTEM_PROMPT: string = '你是数据分析助手。基于给定的数据摘要，用与用户问题相同的语言简洁、准确地回答。' +
  '摘要中没有的信息不要编造；无法从摘要得出结论时请明确说明。';

/** Whether an LLM endpoint is configured (web: /api/v1/nl/config). */
export function llmConfigured(config: LlmConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.model.trim().length > 0;
}

function completionsUrl(baseUrl: string): string {
  let b = baseUrl.trim();
  while (b.length > 0 && b.charAt(b.length - 1) === '/') {
    b = b.substring(0, b.length - 1);
  }
  if (b.lastIndexOf('/chat/completions') >= 0) {
    return b;
  }
  return b + '/chat/completions';
}

/**
 * One non-streaming chat completion against an OpenAI-compatible endpoint
 * (web: backend LLM behind /api/v1/nl/*). Throws on network/HTTP errors —
 * callers fall back to the local engine.
 */
export async function chatCompletion(config: LlmConfig, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const body: ChatCompletionBody = {
    model: config.model.trim(),
    messages: messages,
    temperature: 0.2,
    max_tokens: maxTokens
  };
  const headers: Record<string, string> = {};
  headers['Content-Type'] = 'application/json';
  const key = config.apiKey.trim();
  if (key.length > 0) {
    headers['Authorization'] = 'Bearer ' + key;
  }
  const client = http.createHttp();
  try {
    const opts: http.HttpRequestOptions = {
      method: http.RequestMethod.POST,
      header: headers,
      extraData: JSON.stringify(body),
      connectTimeout: 15000,
      readTimeout: 120000,
      expectDataType: http.HttpDataType.STRING
    };
    const resp = await client.request(completionsUrl(config.baseUrl), opts);
    if (resp.responseCode < 200 || resp.responseCode >= 300) {
      throw new Error('LLM HTTP ' + resp.responseCode);
    }
    const parsed = JSON.parse(resp.result as string) as ChatCompletionResponse;
    if (parsed.choices === undefined || parsed.choices.length === 0 || parsed.choices[0].message === undefined
      || parsed.choices[0].message.content === undefined || parsed.choices[0].message.content === null) {
      throw new Error('LLM empty response');
    }
    return parsed.choices[0].message.content;
  } finally {
    client.destroy();
  }
}

/** Column/dtype/sample summary shared by the ops and ask prompts. */
export function buildDataContext(df: DataFrame): string {
  const parts: string[] = [];
  for (let i = 0; i < df.columns.length; i++) {
    parts.push(df.columns[i].name + '(' + df.columns[i].dtype + ')');
  }
  let text = '数据集: ' + df.name + '\n列: ' + parts.join(', ');
  const n = Math.min(3, df.rowCount);
  if (n > 0) {
    text += '\n前' + n + '行: ';
    for (let r = 0; r < n; r++) {
      const row: string[] = [];
      for (let c = 0; c < Math.min(5, df.colCount); c++) {
        const v = df.rows[r][c];
        row.push(df.columns[c].name + '=' + (v === null || v === undefined ? '' : String(v)));
      }
      text += '{' + row.join(', ') + '}';
    }
  }
  return text;
}

export function opsSystemPrompt(): string {
  return OPS_SYSTEM_PROMPT;
}

export function askSystemPrompt(): string {
  return ASK_SYSTEM_PROMPT;
}

function dfHasColumn(df: DataFrame, name: string): boolean {
  for (let i = 0; i < df.columns.length; i++) {
    if (df.columns[i].name === name) {
      return true;
    }
  }
  return false;
}

/**
 * Parse an LLM reply into validated TransformOps (web: backend nl ops). Only
 * whitelisted types with existing column references are kept; returns [] when
 * the reply is unparsable so callers fall back to the local NlParser.
 */
export function parseOpsReply(text: string, df: DataFrame): TransformOp[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return [];
  }
  let ops: LlmOp[] = [];
  try {
    ops = JSON.parse(text.substring(start, end + 1)) as LlmOp[];
  } catch (e) {
    return [];
  }
  const out: TransformOp[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === undefined || op.params === undefined) {
      continue;
    }
    const type = op.type;
    if (LLM_OP_TYPES.indexOf(type) < 0) {
      continue;
    }
    const prm = op.params;
    let params = '';
    let valid = false;
    switch (type) {
      case 'dedupe':
      case 'dropNa': {
        const p: DedupeParams = { columns: null };
        params = JSON.stringify(p);
        valid = true;
        break;
      }
      case 'fillMissing': {
        if (prm.column !== undefined && dfHasColumn(df, prm.column)) {
          const p: FillMissingParams = { column: prm.column, value: prm.value !== undefined ? prm.value : '0' };
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      case 'filter': {
        if (prm.column !== undefined && dfHasColumn(df, prm.column) && prm.value !== undefined) {
          const p: FilterParams = {
            column: prm.column,
            operator: prm.operator !== undefined ? prm.operator : 'eq',
            value: prm.value
          };
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      case 'sort': {
        if (prm.column !== undefined && dfHasColumn(df, prm.column)) {
          const p: SortParams = { column: prm.column, ascending: prm.ascending !== false };
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      case 'rename': {
        if (prm.oldName !== undefined && dfHasColumn(df, prm.oldName) && prm.newName !== undefined
          && prm.newName.length > 0) {
          const p: RenameParams = { oldName: prm.oldName, newName: prm.newName };
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      case 'parse_numeric': {
        if (prm.column !== undefined && dfHasColumn(df, prm.column)) {
          const p: SingleColumnParams = { column: prm.column };
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      case 'clip': {
        if (prm.column !== undefined && dfHasColumn(df, prm.column)) {
          const p: ClipParams = { column: prm.column };
          if (prm.min !== undefined) {
            p.min = prm.min;
          }
          if (prm.max !== undefined) {
            p.max = prm.max;
          }
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      case 'compute': {
        if (prm.name !== undefined && prm.sourceColumn !== undefined && dfHasColumn(df, prm.sourceColumn)
          && prm.operation !== undefined) {
          const opName = prm.operation;
          if (opName === 'abs' || opName === 'neg' || opName === 'sqrt' || opName === 'square') {
            const p: ComputeParams = { name: prm.name, sourceColumn: prm.sourceColumn, operation: opName };
            params = JSON.stringify(p);
            valid = true;
          }
        }
        break;
      }
      case 'pivot': {
        if (prm.index !== undefined && dfHasColumn(df, prm.index) && prm.columns !== undefined
          && dfHasColumn(df, prm.columns) && prm.values !== undefined && dfHasColumn(df, prm.values)) {
          const p: PivotParams = {
            index: prm.index,
            columns: prm.columns,
            values: prm.values,
            agg: prm.agg !== undefined ? prm.agg : 'sum'
          };
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      case 'melt': {
        if (prm.idVars !== undefined && prm.idVars.length > 0 && dfHasColumn(df, prm.idVars[0])) {
          const p: MeltParams = { idVars: prm.idVars };
          params = JSON.stringify(p);
          valid = true;
        }
        break;
      }
      default:
        break;
    }
    if (valid) {
      out.push(new TransformOp(type, params));
    }
  }
  return out;
}
