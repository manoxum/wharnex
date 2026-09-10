import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { CodeEditor } from './CodeEditor'
import { Icon } from './Icon'
import { TranslatableMarkdown } from './TranslatableMarkdown'

export function FilePreviewModal({ sessionId, path, onOpenInEditor, onClose }: {
  sessionId: string
  path: string
  onOpenInEditor: (path: string) => void
  onClose: () => void
}) {
  const [content, setContent] = useState<string>()
  const [size, setSize] = useState<number>()
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setContent(undefined); setError('')
    api.readFile(sessionId, path)
      .then((file) => { if (alive) { setContent(file.content); setSize(file.size) } })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { alive = false }
  }, [sessionId, path])

  return <div className="diff-inspector-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="diff-inspector file-preview-inspector" role="dialog" aria-modal="true" aria-label={`Pré-visualização de ${path}`}>
      <header>
        <div><strong>{path}</strong>{typeof size === 'number' && <span>{formatBytes(size)}</span>}</div>
        <div>
          <button type="button" className="text-button" onClick={() => { onOpenInEditor(path); onClose() }}><Icon name="file" size={12}/> Abrir no Editor</button>
          <button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar pré-visualização"><Icon name="close" size={13}/></button>
        </div>
      </header>
      {error ? <div className="change-diff-loading">{error}</div>
        : content === undefined ? <div className="change-diff-loading">A carregar…</div>
        : isMarkdown(path) ? <div className="file-preview-markdown"><TranslatableMarkdown sessionId={sessionId} markdown={content || 'Ficheiro vazio.'}/></div> : <div className="file-preview-editor"><CodeEditor path={path} value={content} onChange={() => undefined} onSave={() => undefined} onCursorChange={() => undefined} readOnly/></div>}
    </section>
  </div>
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function isMarkdown(path: string) { return /\.(md|mdx|markdown)$/i.test(path) }
