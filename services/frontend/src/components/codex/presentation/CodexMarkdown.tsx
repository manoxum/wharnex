import { MarkdownContent } from '../../presentation/content/MarkdownContent'

// Scope typography to Codex; the shared Markdown renderer retains its own cascade.
const typography = '[&_.markdown-content]:!text-[calc(12px*var(--ui-font-scale))] [&_.markdown-content]:!leading-[1.75] [&_.markdown-content]:!text-whx-text [&_h1]:!text-whx-text [&_h2]:!text-whx-text [&_h3]:!text-whx-text [&_h4]:!text-whx-text [&_a]:!text-whx-accent [&_code]:!bg-whx-muted [&_code]:!font-mono [&_code]:!text-[calc(10px*var(--ui-font-scale))] [&_code]:!text-whx-soft [&_pre]:!border-whx-border-soft [&_pre]:!bg-whx-muted [&_pre]:!text-whx-soft [&_blockquote]:!border-whx-accent [&_blockquote]:!bg-whx-muted [&_blockquote]:!text-whx-soft [&_table]:!bg-transparent [&_th]:!border-whx-border-soft [&_th]:!bg-whx-muted [&_th]:!text-whx-text [&_td]:!border-whx-border-soft [&_hr]:!bg-whx-border-soft'

export function CodexMarkdown({ text }: { text: string }) {
  return <div className={`min-w-0 overflow-x-auto ${typography}`}><MarkdownContent markdown={text}/></div>
}
