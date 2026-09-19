import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatAttachmentInfo } from '../types'
import { artifactPreviewDefinition, type ArtifactPreviewKind } from '../lib/artifactPreviewRegistry'
import { desktopBridge, formatBytes } from '../lib/desktop'
import { storedAttachmentFile } from '../lib/projectTodoForwarding'
import { ArtifactPreview } from './ArtifactPreview'
import { Icon } from './Icon'

type AttachmentViewerSource =
  | { file: File; attachment?: never }
  | { file?: never; attachment: ChatAttachmentInfo }

export function ChatAttachmentViewer({ source, onClose }: { source: AttachmentViewerSource; onClose: () => void }) {
  const initialFile = 'file' in source ? source.file : undefined
  const attachment = 'attachment' in source ? source.attachment : undefined
  const [file, setFile] = useState<File | undefined>(initialFile)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'preview' | 'raw'>('preview')
  const [wrap, setWrap] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const name = file?.name || attachment?.name || 'anexo'
  const size = file?.size ?? attachment?.size ?? 0
  const mime = file?.type || attachment?.mime || 'application/octet-stream'
  const kind = useMemo(() => localPreviewKind(name, mime), [mime, name])
  const definition = useMemo(() => artifactPreviewDefinition(name, kind), [kind, name])
  const [url, setURL] = useState('')

  useEffect(() => {
    if (initialFile) { setFile(initialFile); setError(''); return }
    const storageRef = attachment?.storageRef
    if (!storageRef) { setError('Este anexo histórico não tem uma cópia persistida para abrir.'); return }
    const bridge = desktopBridge()
    if (!bridge) { setError('Abrir anexos persistidos requer o Wharnex Desktop.'); return }
    let alive = true
    setFile(undefined); setError('')
    void bridge.attachments.read({ storageRef }).then((stored) => {
      if (alive) setFile(storedAttachmentFile(stored, attachment?.mime || 'application/octet-stream'))
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o anexo.')
    })
    return () => { alive = false }
  }, [attachment?.mime, attachment?.storageRef, initialFile])

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') { setURL(''); return }
    const next = URL.createObjectURL(file)
    setURL(next)
    return () => { if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(next) }
  }, [file])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus() }
  }, [onClose])

  const canRaw = definition.capabilities.includes('raw')
  const canWrap = definition.capabilities.includes('wrap')
  const body = <div className="artifact-viewer-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="artifact-viewer attachment-viewer" role="dialog" aria-modal="true" aria-label={`Abrir ${name}`}>
      <header>
        <div className="artifact-viewer-heading">
          <span className="artifact-viewer-kind"><Icon name="file" size={16}/></span>
          <div><strong>{name}</strong><small><span>{formatBytes(size)}</span><span>{mime}</span><span>Visualização local</span></small></div>
        </div>
        <div className="artifact-viewer-actions">
          {url && <a href={url} download={name} title={`Descarregar ${name}`}><Icon name="download" size={13}/>Descarregar</a>}
          <button ref={closeRef} type="button" className="icon-button light" onClick={onClose} aria-label="Fechar anexo"><Icon name="close" size={13}/></button>
        </div>
      </header>
      <div className="artifact-viewer-toolbar">
        {canRaw && <div className="artifact-viewer-tool-group"><button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode((value) => value === 'preview' ? 'raw' : 'preview')}>{mode === 'preview' ? 'Ver source' : 'Ver preview'}</button></div>}
        {canWrap && <div className="artifact-viewer-tool-group"><button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>Quebrar linhas</button></div>}
      </div>
      <div className="artifact-viewer-notices" />
      <div className={`artifact-viewer-stage is-${definition.kind}`}>
        {error
          ? <div className="artifact-preview-empty"><Icon name="alert" size={26}/><strong>Não foi possível abrir o anexo</strong><span>{error}</span></div>
          : !file || !url
            ? <div className="artifact-preview-empty"><span className="spinner"/>A abrir o anexo…</div>
            : <ArtifactPreview path={name} url={url} size={file.size} kind={kind} mode={mode} wrap={wrap}/>}
      </div>
    </section>
  </div>

  return createPortal(body, document.body)
}

function localPreviewKind(name: string, mime: string): ArtifactPreviewKind {
  const inferred = artifactPreviewDefinition(name).kind
  // Browser/Electron can render the media/document formats below from a blob
  // URL. Office packages need the backend's bounded extractor and local HTML
  // would lack the artifact endpoint's restrictive response headers, so those
  // formats stay in safe binary/raw views instead of gaining active content or
  // being handed to an external application.
  if (inferred === 'office') return 'binary'
  if (inferred === 'html') return 'text'
  if (inferred !== 'binary') return inferred
  const normalized = mime.toLowerCase().split(';', 1)[0].trim()
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('audio/')) return 'audio'
  if (normalized.startsWith('video/')) return 'video'
  if (normalized === 'application/pdf') return 'pdf'
  if (normalized === 'text/html') return 'text'
  if (normalized === 'text/markdown') return 'markdown'
  if (normalized.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(normalized)) return 'text'
  return 'binary'
}
