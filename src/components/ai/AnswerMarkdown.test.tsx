import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnswerMarkdown } from './AnswerMarkdown'

describe('AnswerMarkdown', () => {
  it('renders headings, lists, bold and gfm tables', () => {
    const html = renderToStaticMarkup(
      <AnswerMarkdown text={'# 标题\n\n- 项目 a\n- 项目 b\n\n**关键数字**\n\n| 列 | 值 |\n|---|---|\n| a | 1 |'} />,
    )
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>项目 a</li>')
    expect(html).toContain('<strong>关键数字</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>列</th>')
  })

  it('converts [n] citations into clickable chips with data-cite', () => {
    const html = renderToStaticMarkup(<AnswerMarkdown text="共 6 行 [2]。" />)
    expect(html).toContain('title="fact [2]"')
    expect(html).toContain('>2</button>')
    expect(html).toContain('共 6 行')
  })

  it('leaves non-citation brackets alone', () => {
    const html = renderToStaticMarkup(<AnswerMarkdown text="参见 [附录] 与 [12x]。" />)
    expect(html).not.toContain('data-cite')
    expect(html).toContain('[附录]')
  })

  it('escapes raw html so scripts cannot run', () => {
    const html = renderToStaticMarkup(<AnswerMarkdown text={'<script>alert(1)</script>'} />)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('tolerates half-streamed markdown without throwing', () => {
    const html = renderToStaticMarkup(<AnswerMarkdown text={'**未闭合粗体\n\n| 表头 |\n|---\n- 列表项'} />)
    expect(html).toContain('未闭合粗体')
  })

  it('renders the streaming caret only when requested', () => {
    expect(renderToStaticMarkup(<AnswerMarkdown text="ok" />)).not.toContain('animate-pulse')
    expect(renderToStaticMarkup(<AnswerMarkdown text="ok" cursor />)).toContain('animate-pulse')
  })
})
