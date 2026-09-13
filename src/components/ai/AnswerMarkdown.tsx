import { memo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface HastNode {
  type?: string
  value?: unknown
  children?: HastNode[]
  tagName?: string
  properties?: Record<string, unknown>
}

/**
 * rehype pass: split text nodes on [n] citation markers and turn each one
 * into a `citechip` element that React Markdown maps to a clickable chip.
 * Raw markdown stays intact everywhere else.
 */
function rehypeCiteChips() {
  const visit = (node: HastNode): void => {
    if (!node || !Array.isArray(node.children)) return
    const next: HastNode[] = []
    let changed = false
    for (const child of node.children) {
      if (child.type === 'text' && /\[\d{1,2}\]/.test(String(child.value))) {
        changed = true
        for (const part of String(child.value).split(/(\[\d{1,2}\])/g)) {
          const match = part.match(/^\[(\d{1,2})\]$/)
          if (match) {
            next.push({
              type: 'element',
              tagName: 'citechip',
              properties: { 'data-cite': match[1] },
              children: [{ type: 'text', value: match[1] }],
            })
          } else if (part) {
            next.push({ type: 'text', value: part })
          }
        }
      } else {
        visit(child)
        next.push(child)
      }
    }
    if (changed) node.children = next
  }
  return (tree: HastNode): void => {
    visit(tree)
  }
}

export interface AnswerMarkdownProps {
  text: string
  /** Click handler for [n] citation chips (omitted in dashboards/exports). */
  onCite?: (n: number) => void
  /** Render the streaming caret at the end of the answer. */
  cursor?: boolean
}

/** Renders an AI answer as safe compact markdown (raw HTML is escaped). */
export const AnswerMarkdown = memo(function AnswerMarkdown({ text, onCite, cursor }: AnswerMarkdownProps) {
  const components: Record<string, (props: Record<string, unknown>) => ReactNode> = {
    citechip: (props) => {
      const n = String(props['data-cite'] ?? '')
      return (
        <button
          type="button"
          title={`fact [${n}]`}
          onClick={() => onCite?.(Number(n))}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 align-middle text-[9px] font-semibold text-primary hover:bg-primary/30"
        >
          {n}
        </button>
      )
    },
  }
  return (
    <div className="qa-markdown text-[11px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeCiteChips]} components={components}>
        {text}
      </ReactMarkdown>
      {cursor && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-primary/70 align-middle" />}
    </div>
  )
})
