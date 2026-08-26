import { describe, expect, it } from 'vitest'
import type { QAConversation } from '@/stores/qaStore'
import { conversationToHtml, conversationToMarkdown } from './qaExport'

const conversation: QAConversation = {
  id: 'conversation-1',
  datasetId: 'dataset-1',
  name: '可复现问答',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  turns: [{
    question: 'North 的值有哪些？',
    answer: '<script>alert(1)</script>',
    evidence: [],
    context: {
      datasetId: 'dataset-1',
      snapshotId: 'snapshot-1',
      filters: [{ field: 'region', op: 'in', values: ['North'] }],
    },
  }],
}

describe('QA export', () => {
  it('includes the snapshot and filters in Markdown', () => {
    const markdown = conversationToMarkdown(conversation)

    expect(markdown).toContain('快照：snapshot-1')
    expect(markdown).toContain('"region"')
  })

  it('includes escaped reproducibility context in HTML', () => {
    const html = conversationToHtml(conversation)

    expect(html).toContain('快照：</strong>snapshot-1')
    expect(html).toContain('筛选条件：</strong>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
