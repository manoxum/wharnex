import { WindowPanelHeader } from '../../workspace/window/chrome'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import { CodeEditor } from '../../editor/canvas/CodeEditor'
import { Button, StatusBadge } from '../../presentation/workbench'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { TranslatableMarkdown } from '../../presentation/content/TranslatableMarkdown'

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

  return <InternalWindow title={`Pré-visualização de ${path}`} layerClassName="diff-inspector-backdrop" onClose={() => void close()} maximizable controlsInHeader closeLabel="Fechar ficheiro">
    <section className="flex h-[min(82vh,860px)] w-[min(94vw,1200px)] min-w-0 flex-col overflow-hidden rounded-xl border border-whx-border bg-whx-bg" role="dialog" aria-modal="false" aria-label={`Pré-visualização de ${path}`}>
      <WindowPanelHeader onClose={() => void close()} closeLabel="Fechar ficheiro" title={path} description={typeof size === 'number' ? formatBytes(size) : 'Pré-visualização de ficheiro'} icon="file">
        {dirty && <StatusBadge tone="warning" icon="edit">Alterado</StatusBadge>}
        {markdown && content !== undefined && <Button tone="quiet" icon={markdownPreview ? 'code' : 'external'} onClick={() => setMarkdownPreview((value) => !value)}>{markdownPreview ? 'Editar' : 'Pré-visualizar'}</Button>}
        <Button icon="save" disabled={!dirty || saving} onClick={() => void save()} title="Guardar (Ctrl+S)">{saving ? 'A guardar…' : 'Guardar'}</Button>
        <Button tone="quiet" icon="file" onClick={() => void openInEditor()}>Abrir no Editor</Button>
      </WindowPanelHeader>

      {error && <div className="border-b border-whx-danger px-4 py-3 text-whx-label text-whx-danger" role="alert">{error}</div>}
      {content === undefined && !error ? <ContentSkeleton label="A carregar ficheiro" rows={8}/>
        : content === undefined ? null
        : markdown && markdownPreview ? <div className="min-h-0 flex-1 overflow-auto p-5"><TranslatableMarkdown sessionId={sessionId} markdown={draft || 'Ficheiro vazio.'}/></div>
        : <div className="min-h-0 flex-1 overflow-hidden"><CodeEditor path={path} value={draft} onChange={setDraft} onSave={() => void save()} onCursorChange={() => undefined}/></div>}
    </section>
  </InternalWindow>
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function isMarkdown(path: string) { return /\.(md|mdx|markdown)$/i.test(path) }
