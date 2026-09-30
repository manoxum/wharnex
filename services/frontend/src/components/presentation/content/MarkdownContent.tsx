import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { memo, useMemo } from 'react'

export const MarkdownContent = memo(function MarkdownContent({ markdown, compact = false }: { markdown: string; compact?: boolean }) {
  // Parsing and sanitizing long transcripts is one of the most expensive
  // render paths in the Agent. Recompute only when the source bytes change;
  // composer keystrokes and execution events must not reparse chat history.
  const html = useMemo(() => String(DOMPurify.sanitize(marked.parse(markdown || '', { async: false, gfm: true, breaks: false }) as string, {
    USE_PROFILES: { html: true },
  })), [markdown])
  return <div className={`markdown-content${compact ? ' compact' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
})
