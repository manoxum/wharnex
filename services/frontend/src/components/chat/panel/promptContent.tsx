import { Fragment, useState } from 'react'
import { MarkdownContent } from '../../presentation/content/MarkdownContent'
import { canonicalDirective, directiveChipLabel, directiveSegments, isCanonicalDirective } from '../../../lib/chat/composer/composerDirectives'
import { directiveChipBadge } from '../../../lib/chat/composer/composerRichText'
import { LONG_CHAT_MARKDOWN_CHARS, LONG_CHAT_MARKDOWN_LINES, LONG_USER_PROMPT_CHARS, LONG_USER_PROMPT_LINES, collapsedUserPromptPreview, collapsedMarkdownPreview } from './presentation/promptPreview'

export function ExpandableUserPrompt({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = text.length > LONG_USER_PROMPT_CHARS || text.split('\n', LONG_USER_PROMPT_LINES + 1).length > LONG_USER_PROMPT_LINES
  const visibleText = collapsible && !expanded ? collapsedUserPromptPreview(text) : text
  return <div className={`chat-prompt-disclosure${collapsible ? ' collapsible' : ''}${expanded ? ' expanded' : ''}`}>
    <div className="chat-prompt-window"><UserPromptContent text={visibleText}/></div>
    {collapsible && <button type="button" className="chat-markdown-toggle chat-prompt-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos' : 'Expandir prompt'}
    </button>}
  </div>
}

export function UserPromptContent({ text }: { text: string }) {
  return <>{directiveSegments(text).map((segment, index) => {
    const directive = segment.directive
    if (!directive || !isCanonicalDirective(text, directive)) return <Fragment key={index}>{segment.text}</Fragment>
    const marker = canonicalDirective(directive)
    return <span key={index} className={`chat-prompt-directive ${directive.kind}`} title={marker} data-chat-prompt-directive={directive.kind}>
      <span className="chat-prompt-directive-badge">{directiveChipBadge(directive.kind)}</span>
      <span className="chat-prompt-directive-label">{directiveChipLabel(directive)}</span>
    </span>
  })}</>
}

export function ExpandableMarkdown({ markdown }: { markdown: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = markdown.length > LONG_CHAT_MARKDOWN_CHARS || markdown.split('\n', LONG_CHAT_MARKDOWN_LINES + 1).length > LONG_CHAT_MARKDOWN_LINES
  const visibleMarkdown = collapsible && !expanded ? collapsedMarkdownPreview(markdown) : markdown
  return <div className={`chat-markdown-disclosure${collapsible ? ' collapsible' : ''}${expanded ? ' expanded' : ''}`}>
    <div className="chat-markdown-window"><MarkdownContent markdown={visibleMarkdown}/></div>
    {collapsible && <button type="button" className="chat-markdown-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <span aria-hidden="true">{expanded ? '−' : '···'}</span>{expanded ? 'Mostrar menos' : 'Expandir conteúdo'}
    </button>}
  </div>
}
