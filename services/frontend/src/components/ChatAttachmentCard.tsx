import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ChatAttachmentInfo } from '../types'
import { desktopBridge } from '../lib/desktop'
import { formatBytes } from '../lib/desktop'
import { Icon } from './Icon'
import { requestArtifactIndex } from '../lib/artifactIndexing'
import { ChatAttachmentViewer } from './ChatAttachmentViewer'

export function MessageAttachmentCard({ attachment }: { attachment: ChatAttachmentInfo }) {
  const [preview, setPreview] = useState('')
  const [viewerOpen, setViewerOpen] = useState(false)

  useEffect(() => {
    let alive = true
    if (!attachment.storageRef || attachment.previewKind === 'none') return () => { alive = false }
    const bridge = desktopBridge()
    if (!bridge) return () => { alive = false }
    void bridge.attachments.preview({ storageRef: attachment.storageRef }).then((result) => {
      if (!alive) return
      setPreview(result.available ? result.dataUrl || '' : '')
    }).catch(() => { if (alive) setPreview('') })
    return () => { alive = false }
  }, [attachment.previewKind, attachment.storageRef])

  const persisted = Boolean(attachment.storageRef)
  return <Fragment>
    <article className={`message-attachment-card${persisted ? ' is-persisted' : ''}`}>
      <button type="button" className="message-attachment-open" disabled={!persisted} onClick={() => setViewerOpen(true)} title={persisted ? `Abrir ${attachment.name} no Wharnex` : `${attachment.name} · anexo histórico sem cópia persistida`} aria-label={persisted ? `Abrir ${attachment.name} no Wharnex` : undefined}>
        <AttachmentVisual preview={preview} name={attachment.name} />
        <span className="message-attachment-copy"><b>{attachment.name}</b><small>{formatBytes(attachment.size)}{attachment.mime ? ` · ${attachment.mime}` : ''}</small></span>
      </button>
      <button type="button" className="message-attachment-index" onClick={() => requestArtifactIndex('chat', attachment.name)} title="Indexar no próximo prompt" aria-label={`Indexar ${attachment.name} no composer`}><Icon name="link" size={12}/></button>
    </article>
    {viewerOpen && persisted && <ChatAttachmentViewer source={{ attachment }} onClose={() => setViewerOpen(false)}/>}
  </Fragment>
}

export function ComposerAttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const preview = useLocalImagePreview(file)
  const [viewerOpen, setViewerOpen] = useState(false)
  return <Fragment>
    <span className="composer-attachment-chip" title={`${file.name} · ${formatBytes(file.size)}`}>
      <button type="button" className="composer-attachment-open" onClick={() => setViewerOpen(true)} aria-label={`Abrir ${file.name} no Wharnex`}>
        <AttachmentVisual preview={preview} name={file.name} />
        <span className="composer-attachment-copy"><b>{file.name}</b><small>{formatBytes(file.size)}</small></span>
      </button>
      <button type="button" className="composer-attachment-remove" aria-label={`Remover ${file.name}`} onClick={onRemove}>×</button>
    </span>
    {viewerOpen && <ChatAttachmentViewer source={{ file }} onClose={() => setViewerOpen(false)}/>}
  </Fragment>
}

function AttachmentVisual({ preview, name }: { preview: string; name: string }) {
  return <span className="attachment-visual" aria-hidden="true">
    {preview ? <img src={preview} alt="" /> : <><Icon name="file" size={15}/><em>{extension(name)}</em></>}
  </span>
}

const SAFE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])

function useLocalImagePreview(file: File) {
  const image = useMemo(() => SAFE_IMAGE_MIMES.has(file.type.toLowerCase()) && file.size <= 8 * 1024 * 1024, [file.size, file.type])
  const [url, setURL] = useState('')
  useEffect(() => {
    if (!image || typeof URL.createObjectURL !== 'function') { setURL(''); return }
    const next = URL.createObjectURL(file)
    setURL(next)
    return () => { if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(next) }
  }, [file, image])
  return url
}

function extension(name: string) {
  const value = name.split('.').pop()?.trim().toUpperCase() || 'FILE'
  return value.length <= 5 ? value : 'FILE'
}
