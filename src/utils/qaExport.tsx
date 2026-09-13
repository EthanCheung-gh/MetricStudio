import { renderToStaticMarkup } from 'react-dom/server'
import type { QAConversation } from '@/stores/qaStore'
import { AnswerMarkdown } from '@/components/ai/AnswerMarkdown'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

/** Render an answer as static HTML for exports (chips become plain marks). */
function answerToHtml(answer: string): string {
  return renderToStaticMarkup(<AnswerMarkdown text={answer} />)
}

function formatFilters(filters: unknown): string {
  return Array.isArray(filters) && filters.length > 0 ? JSON.stringify(filters) : '无'
}

export function conversationToMarkdown(conversation: QAConversation): string {
  const lines = [`# ${conversation.name}`, '', `- 数据集：${conversation.datasetId}`, `- 更新时间：${conversation.updatedAt}`, '']
  conversation.turns.forEach((turn, index) => {
    lines.push(`## ${index + 1}. ${turn.question}`, '', turn.answer, '')
    if (turn.generatedAt || turn.context?.model) {
      lines.push(`> 生成时间：${turn.generatedAt ?? '未知'}；模型：${turn.context?.model ?? '未知'}`, '')
    }
    if (turn.context?.snapshotId || turn.context?.filters?.length) {
      lines.push(`> 快照：${turn.context.snapshotId ?? '当前数据'}；筛选条件：${formatFilters(turn.context.filters)}`, '')
    }
    if (turn.evidence.length > 0) {
      lines.push('### 证据', '')
      turn.evidence.forEach((item, evidenceIndex) => lines.push(`${evidenceIndex + 1}. [${item.kind}] ${item.detail}`))
      lines.push('')
    }
  })
  return lines.join('\n')
}

export function conversationToHtml(conversation: QAConversation): string {
  const body = conversation.turns.map((turn, index) => `
    <article><h2>${index + 1}. ${escapeHtml(turn.question)}</h2>
    <div class="qa-markdown">${answerToHtml(turn.answer)}</div>
    ${turn.context?.snapshotId || turn.context?.filters?.length ? `<p><strong>快照：</strong>${escapeHtml(turn.context?.snapshotId ?? '当前数据')}<br><strong>筛选条件：</strong>${escapeHtml(formatFilters(turn.context?.filters))}</p>` : ''}
    ${turn.evidence.length ? `<h3>证据</h3><ol>${turn.evidence.map((item) => `<li><strong>${escapeHtml(item.kind)}</strong> ${escapeHtml(item.detail)}</li>`).join('')}</ol>` : ''}
    </article>`).join('')
  const answerStyles = `body{font-family:system-ui;max-width:860px;margin:40px auto;line-height:1.6;color:#222}article{border-top:1px solid #ddd;padding:20px 0}li{color:#555}.qa-markdown p{margin:.35em 0}.qa-markdown h1,.qa-markdown h2,.qa-markdown h3,.qa-markdown h4{margin:.6em 0 .3em;font-weight:600}.qa-markdown ul,.qa-markdown ol{margin:.35em 0;padding-left:1.4em}.qa-markdown code{font-family:ui-monospace,Menlo,monospace;font-size:.92em;background:#f0f0f2;border:1px solid #ddd;border-radius:3px;padding:0 .25em}.qa-markdown pre{margin:.45em 0;padding:.5em .6em;background:#f0f0f2;border:1px solid #ddd;border-radius:6px;overflow-x:auto}.qa-markdown blockquote{margin:.45em 0;padding:.1em .8em;border-left:3px solid #ddd;color:#555}.qa-markdown table{margin:.5em 0;border-collapse:collapse;font-size:.95em}.qa-markdown th,.qa-markdown td{border:1px solid #ddd;padding:.25em .5em;text-align:left}.qa-markdown th{background:#f0f0f2;font-weight:600}.qa-markdown citechip{display:inline-flex;align-items:center;justify-content:center;min-width:1.2em;border-radius:999px;background:rgba(59,130,246,.15);color:#3b82f6;font-size:.8em;font-weight:600;padding:0 .35em;margin:0 .15em}`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(conversation.name)}</title><style>${answerStyles}</style></head><body><h1>${escapeHtml(conversation.name)}</h1><p>数据集：${escapeHtml(conversation.datasetId)}</p>${body}</body></html>`
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
