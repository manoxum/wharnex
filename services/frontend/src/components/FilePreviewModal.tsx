import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/appDialog'
import { CodeEditor } from './CodeEditor'
import { Icon } from './Icon'
import { InternalWindow } from './InternalWindow'
import { TranslatableMarkdown } from './TranslatableMarkdown'

export function FilePreviewModal({ sessionId, path, onOpenInEditor, onClose }: {
  sessionId: string
  path: string
  onOpenInEditor: (path: string) => void
  onClose: () => void
}) {
  const [content, setContent] = useState<string>()
  const [draft, setDraft] = useState('')
  const [sha256, setSha256] = useState('')
  const [size, setSize] = useState<number>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const dirty = content !== undefined && draft !== content
  const markdown = isMarkdown(path)

  useEffect(() => {
    let alive = true
    setContent(undefined); setDraft(''); setSha256(''); setSize(undefined); setError(''); setMarkdownPreview(false)
    api.readFile(sessionId, path)
      .then((file) => {
        if (!alive) return
        setContent(file.content); setDraft(file.content); setSha256(file.sha256); setSize(file.size)
      })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { alive = false }
  }, [sessionId, path])

  async function save() {
    if (!dirty) return true
    if (saving) return false
    setSaving(true); setError('')
    try {
      const file = await api.writeFile(sessionId, { path, content: draft, sha256 })
      setContent(file.content); setDraft(file.content); setSha256(file.sha256); setSize(file.size)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function openInEditor() {
    if (!(await save())) return
    onOpenInEditor(path)
    onClose()
  }

  async function close() {
    if (dirty && !(await confirmDialog({
      title: 'Descartar alterações não guardadas?',
      message: `Fechar “${path}” agora descartará as alterações ainda não guardadas deste ficheiro.`,
      tone: 'warning',
      confirmLabel: 'Fechar e descartar',
    }))) return
    onClose()
  }

  return <InternalWindow title={`Pré-visualização de ${path}`} layerClassName="diff-inspector-backdrop" onClose={() => void close()}>
    <section className="diff-inspector file-preview-inspector" role="dialog" aria-modal="false" aria-label={`Pré-visualização de ${path}`}>
      <header>
        <div><strong>{path}</strong>{typeof size === 'number' && <span>{formatBytes(size)}</span>}{dirty && <span className="file-preview-dirty">Alterado</span>}</div>
        <div>
          {markdown && content !== undefined && <button type="button" className="text-button" onClick={() => setMarkdownPreview((value) => !value)}><Icon name={markdownPreview ? 'code' : 'external'} size={12}/>{markdownPreview ? 'Editar' : 'Pré-visualizar'}</button>}
          <button type="button" className="text-button" disabled={!dirty || saving} onClick={() => void save()} title="Guardar (Ctrl+S)"><Icon name="save" size={12}/>{saving ? 'A guardar…' : 'Guardar'}</button>
          <button type="button" className="text-button" onClick={() => void openInEditor()}><Icon name="file" size={12}/> Abrir no Editor</button>
          <button type="button" className="icon-button light" onClick={() => void close()} aria-label="Fechar ficheiro"><Icon name="close" size={13}/></button>
        </div>
      </header>
      {error && <div className="file-preview-error" role="alert">{error}</div>}
      {content === undefined && !error ? <div className="change-diff-loading">A carregar…</div>
        : content === undefined ? null
        : markdown && markdownPreview ? <div className="file-preview-markdown"><TranslatableMarkdown sessionId={sessionId} markdown={draft || 'Ficheiro vazio.'}/></div>
        : <div className="file-preview-editor"><CodeEditor path={path} value={draft} onChange={setDraft} onSave={() => void save()} onCursorChange={() => undefined}/></div>}
    </section>
  </InternalWindow>
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function isMarkdown(path: string) { return /\.(md|mdx|markdown)$/i.test(path) }
