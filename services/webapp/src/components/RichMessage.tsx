import type { ReactNode } from 'react'
import type { ChatItem } from '../types'

export function RichMessage({ item, user }: { item: ChatItem; user: boolean }) {
  return <div className={user ? 'text-accent-ink' : 'text-ink'}>
    <Markdown text={item.text}/>
    {item.attachments?.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{item.attachments.map((attachment, index) => <Attachment key={`${attachment.name}-${index}`} name={attachment.name} mime={attachment.mime} size={attachment.size}/>)}</div> : null}
  </div>
}

function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/)
  return <div className="space-y-2 text-sm leading-6">{blocks.map((block, index) => index % 2 ? <pre key={index} className="overflow-x-auto rounded-xl border border-line-soft bg-muted p-3 font-mono text-[11px] leading-5 text-soft"><code>{stripLanguage(block)}</code></pre> : <Prose key={index} text={block}/>)}</div>
}

function Prose({ text }: { text: string }) {
  return <>{text.split('\n').map((line, index) => {
    const value = line.trimEnd()
    if (!value) return <div key={index} className="h-1"/>
    if (value.startsWith('### ')) return <h4 key={index} className="pt-1 text-sm font-bold">{inline(value.slice(4))}</h4>
    if (value.startsWith('## ')) return <h3 key={index} className="pt-1 text-base font-bold">{inline(value.slice(3))}</h3>
    if (value.startsWith('# ')) return <h2 key={index} className="pt-1 text-lg font-bold">{inline(value.slice(2))}</h2>
    if (/^[-*] /.test(value)) return <p key={index} className="pl-1"><span className="mr-2 text-accent">•</span>{inline(value.slice(2))}</p>
    if (/^\d+\. /.test(value)) return <p key={index} className="pl-1">{inline(value)}</p>
    if (value.startsWith('> ')) return <blockquote key={index} className="border-l-2 border-accent/40 pl-3 text-soft">{inline(value.slice(2))}</blockquote>
    return <p key={index} className="break-words">{inline(value)}</p>
  })}</>
}

function inline(text: string): ReactNode[] {
  const pattern = /(https?:\/\/[^\s]+|`[^`]+`|\*\*[^*]+\*\*)/g
  const parts = text.split(pattern)
  return parts.filter(Boolean).map((part, index) => {
    if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2">{part}</a>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    return <span key={index}>{part}</span>
  })
}

function stripLanguage(value: string) {
  const newline = value.indexOf('\n')
  if (newline < 0) return value
  const first = value.slice(0, newline).trim()
  return /^[A-Za-z0-9_+.-]{1,24}$/.test(first) ? value.slice(newline + 1).replace(/\n$/, '') : value.replace(/\n$/, '')
}

function Attachment({ name, mime = '', size }: { name: string; mime?: string; size: number }) {
  const kind = mime.startsWith('image/') ? 'Imagem' : mime.startsWith('video/') ? 'Vídeo' : mime.startsWith('audio/') ? 'Áudio' : mime.includes('pdf') ? 'PDF' : 'Ficheiro'
  return <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line-soft bg-muted/70 p-2.5"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-sm text-accent">{kind === 'Imagem' ? '▧' : kind === 'Vídeo' ? '▶' : kind === 'Áudio' ? '♪' : '↳'}</div><div className="min-w-0"><p className="truncate text-xs font-semibold">{name}</p><p className="mt-0.5 text-[10px] text-faint">{kind} · {formatBytes(size)}</p></div></div>
}
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
