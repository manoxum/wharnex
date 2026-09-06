import { useEffect, useMemo, useState } from 'react'
import { MarkdownContent } from './MarkdownContent'
import { Icon } from './Icon'

const MAX_TEXT_PREVIEW_BYTES = 16 * 1024 * 1024

export function ArtifactPreview({ path, url, size }: { path: string; url: string; size: number }) {
  const kind = useMemo(() => previewKind(path), [path])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    if (kind !== 'text' && kind !== 'markdown' && kind !== 'office') return
    const controller = new AbortController(); let alive = true
    setLoading(true); setText(''); setError(''); setTruncated(false)
    const source = kind === 'office' ? `${url}${url.includes('?') ? '&' : '?'}preview=office` : url
    void streamText(source, controller.signal).then((result) => { if (alive) { setText(result.text); setTruncated(result.truncated) } }).catch((reason) => { if (alive && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha ao abrir o ficheiro.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; controller.abort() }
  }, [kind, url])
  if (kind === 'image') return <div className="artifact-media-preview"><img src={url} alt={path} loading="lazy" /></div>
  if (kind === 'audio') return <div className="artifact-media-preview"><audio src={url} controls preload="metadata" /></div>
  if (kind === 'video') return <div className="artifact-media-preview"><video src={url} controls preload="metadata" /></div>
  if (kind === 'pdf' || kind === 'html') return <iframe className="artifact-document-frame" src={url} title={`Pré-visualização de ${path}`} sandbox={kind === 'html' ? '' : undefined} />
  if (kind === 'binary') return <PreviewEmpty title="Formato sem pré-visualização segura" text={`${size.toLocaleString('pt-PT')} bytes · descarregue para abrir no programa apropriado.`} />
  if (loading) return <div className="artifact-preview-empty"><span className="spinner"/>A abrir por stream…</div>
  if (error) return <div className="artifact-preview-empty composer-error">{error}</div>
  return <div className="artifact-text-preview">{truncated && <div className="artifact-preview-warning">Pré-visualização limitada aos primeiros 16 MiB; o download mantém o ficheiro completo.</div>}{kind === 'markdown' ? <MarkdownContent markdown={text || 'Ficheiro vazio.'}/> : <pre>{text}</pre>}</div>
}

function PreviewEmpty({ title, text }: { title: string; text: string }) { return <div className="artifact-preview-empty"><Icon name="file" size={28}/><strong>{title}</strong><span>{text}</span></div> }

async function streamText(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${MAX_TEXT_PREVIEW_BYTES - 1}` } })
  if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`)
  if (!response.body) return { text: await response.text(), truncated: false }
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let received = 0; let text = ''; let truncated = false
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    const remaining = MAX_TEXT_PREVIEW_BYTES - received
    if (remaining <= 0) { truncated = true; await reader.cancel(); break }
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
    received += chunk.byteLength; text += decoder.decode(chunk, { stream: true })
    if (chunk.byteLength < value.byteLength) { truncated = true; await reader.cancel(); break }
  }
  text += decoder.decode()
  const contentRange = response.headers.get('content-range')
  const ranged = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  return { text, truncated: truncated || Boolean(ranged && Number(ranged[2]) + 1 < Number(ranged[3])) }
}

function previewKind(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(extension)) return 'image'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension)) return 'audio'
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(extension)) return 'video'
  if (extension === 'pdf') return 'pdf'
  if (['html', 'htm'].includes(extension)) return 'html'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'].includes(extension)) return 'office'
  if (['md', 'mdx', 'markdown'].includes(extension)) return 'markdown'
  if (['txt', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'js', 'jsx', 'ts', 'tsx', 'go', 'py', 'sh', 'css', 'scss', 'sql', 'diff', 'patch', 'log', 'ini', 'env', 'conf'].includes(extension)) return 'text'
  return 'binary'
}
