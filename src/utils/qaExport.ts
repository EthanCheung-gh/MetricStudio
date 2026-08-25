import type { QAConversation } from '@/stores/qaStore'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

export function conversationToMarkdown(conversation: QAConversation): string {
  const lines = [`# ${conversation.name}`, '', `- 数据集：${conversation.datasetId}`, `- 更新时间：${conversation.updatedAt}`, '']
  conversation.turns.forEach((turn, index) => {
    lines.push(`## ${index + 1}. ${turn.question}`, '', turn.answer, '')
    if (turn.generatedAt || turn.context?.model) {
      lines.push(`> 生成时间：${turn.generatedAt ?? '未知'}；模型：${turn.context?.model ?? '未知'}`, '')
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
    <p>${escapeHtml(turn.answer).replace(/\n/g, '<br>')}</p>
    ${turn.evidence.length ? `<h3>证据</h3><ol>${turn.evidence.map((item) => `<li><strong>${escapeHtml(item.kind)}</strong> ${escapeHtml(item.detail)}</li>`).join('')}</ol>` : ''}
    </article>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(conversation.name)}</title><style>body{font-family:system-ui;max-width:860px;margin:40px auto;line-height:1.6;color:#222}article{border-top:1px solid #ddd;padding:20px 0}li{color:#555}</style></head><body><h1>${escapeHtml(conversation.name)}</h1><p>数据集：${escapeHtml(conversation.datasetId)}</p>${body}</body></html>`
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
