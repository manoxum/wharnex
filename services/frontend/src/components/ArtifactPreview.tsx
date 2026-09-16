import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { artifactPreviewDefinition, type ArtifactPreviewKind } from '../lib/artifactPreviewRegistry'
import { MarkdownContent } from './MarkdownContent'
import { TranslatableMarkdown } from './TranslatableMarkdown'
import { Icon } from './Icon'

const MAX_TEXT_PREVIEW_BYTES = 16 * 1024 * 1024

export function ArtifactPreview({ path, url, size, kind: declaredKind, mode = 'preview', wrap = false, compact = false, sessionId, highlight = '' }: {
  path: string
  url: string
  size: number
  kind?: ArtifactPreviewKind | string
  mode?: 'preview' | 'raw'
  wrap?: boolean
  compact?: boolean
  sessionId?: string
  highlight?: string
}) {
  const kind = useMemo(() => artifactPreviewDefinition(path, declaredKind).kind, [declaredKind, path])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const needsText = kind === 'text' || kind === 'markdown' || kind === 'office' || (kind === 'html' && mode === 'raw')
  useEffect(() => {
    if (!needsText) return
    const controller = new AbortController(); let alive = true
    setLoading(true); setText(''); setError(''); setTruncated(false)
    const source = kind === 'office' ? `${url}${url.includes('?') ? '&' : '?'}office=1` : url
    const limit = compact ? 96 * 1024 : MAX_TEXT_PREVIEW_BYTES
    void streamText(source, controller.signal, limit).then((result) => { if (alive) { setText(result.text); setTruncated(result.truncated) } }).catch((reason) => { if (alive && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha ao abrir o ficheiro.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; controller.abort() }
  }, [compact, kind, mode, needsText, url])
  if (kind === 'image') return <div className="artifact-media-preview"><img src={url} alt={path} loading="lazy" /></div>
  if (kind === 'audio') return <div className="artifact-media-preview"><audio src={url} controls preload="metadata" /></div>
  if (kind === 'video') return <div className="artifact-media-preview"><video src={url} controls preload="metadata" /></div>
  if (kind === 'pdf' || (kind === 'html' && mode === 'preview')) return <iframe className="artifact-document-frame" src={url} title={`Pré-visualização de ${path}`} sandbox={kind === 'html' ? '' : undefined} referrerPolicy="no-referrer" loading="lazy" />
  if (kind === 'binary') return <PreviewEmpty title="Formato sem pré-visualização segura" text={`${size.toLocaleString('pt-PT')} bytes · descarregue para abrir no programa apropriado.`} />
  if (loading) return <div className="artifact-preview-empty"><span className="spinner"/>A abrir por stream…</div>
  if (error) return <div className="artifact-preview-empty composer-error">{error}</div>
  return <div className={`artifact-text-preview ${wrap ? 'artifact-text-wrap' : ''}`}>{truncated && !compact && <div className="artifact-preview-warning">Pré-visualização limitada; o download mantém o ficheiro completo.</div>}{kind === 'markdown' && mode === 'preview'
    ? (sessionId && !compact ? <TranslatableMarkdown sessionId={sessionId} markdown={text || 'Ficheiro vazio.'}/> : <MarkdownContent markdown={text || 'Ficheiro vazio.'} compact={compact}/>)
    : kind === 'office' && mode === 'preview' && sessionId && !compact
      ? <TranslatableMarkdown sessionId={sessionId} markdown={text || 'Ficheiro vazio.'}/>
      : <HighlightedPre text={text} query={highlight}/>}</div>
}

function HighlightedPre({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  if (!needle) return <pre>{text}</pre>
  const lower = text.toLocaleLowerCase('pt')
  const target = needle.toLocaleLowerCase('pt')
  const parts: ReactNode[] = []
  let cursor = 0
  let match = lower.indexOf(target)
  let key = 0
  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match))
    parts.push(<mark key={key++}>{text.slice(match, match + needle.length)}</mark>)
    cursor = match + needle.length
    match = lower.indexOf(target, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <pre>{parts}</pre>
}

function PreviewEmpty({ title, text }: { title: string; text: string }) { return <div className="artifact-preview-empty"><Icon name="file" size={28}/><strong>{title}</strong><span>{text}</span></div> }

async function streamText(url: string, signal: AbortSignal, limit: number) {
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${limit - 1}` } })
  if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`)
  if (!response.body) return { text: await response.text(), truncated: false }
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let received = 0; let text = ''; let truncated = false
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    const remaining = limit - received
    if (remaining <= 0) { truncated = true; await reader.cancel(); break }
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
    received += chunk.byteLength; text += decoder.decode(chunk, { stream: true })
    if (chunk.byteLength < value.byteLength) { truncated = true; await reader.cancel(); break }
  }
  text += decoder.decode()
  const ranged = response.headers.get('content-range')?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  return { text, truncated: truncated || Boolean(ranged && Number(ranged[2]) + 1 < Number(ranged[3])) }
}
