import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function MarkdownContent({ markdown, compact = false }: { markdown: string; compact?: boolean }) {
  const html = String(DOMPurify.sanitize(marked.parse(markdown || '', { async: false, gfm: true, breaks: false }) as string, {
    USE_PROFILES: { html: true },
  }))
  return <div className={`markdown-content${compact ? ' compact' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}
