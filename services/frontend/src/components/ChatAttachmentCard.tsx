import { useEffect, useMemo, useState } from 'react'
import type { ChatAttachmentInfo } from '../types'
import { desktopBridge } from '../lib/desktop'
import { formatBytes } from '../lib/desktop'
import { Icon } from './Icon'
import { requestArtifactIndex } from '../lib/artifactIndexing'
import { artifactPreviewDefinition } from '../lib/artifactPreviewRegistry'
import { ArtifactViewerModal, type ArtifactViewerItem } from './ArtifactViewerModal'

export function MessageAttachmentCard({ attachment }: { attachment: ChatAttachmentInfo }) {
  const [preview, setPreview] = useState('')
  const [available, setAvailable] = useState(Boolean(attachment.storageRef))
  const [opening, setOpening] = useState(false)
  const [viewer, setViewer] = useState<{ url: string; item: ArtifactViewerItem }>()

  useEffect(() => {
    let alive = true
    if (!attachment.storageRef || attachment.previewKind === 'none') return () => { alive = false }
    const bridge = desktopBridge()
    if (!bridge) return () => { alive = false }
    void bridge.attachments.preview({ storageRef: attachment.storageRef }).then((result) => {
      if (!alive) return
      setAvailable(result.available)
      setPreview(result.dataUrl || '')
    }).catch(() => { if (alive) setAvailable(false) })
    return () => { alive = false }
  }, [attachment.previewKind, attachment.storageRef])

  async function openAttachment() {
    if (!attachment.storageRef || opening) return
    const bridge = desktopBridge()
    if (!bridge) return
    setOpening(true)
    try {
      const result = await bridge.attachments.read({ storageRef: attachment.storageRef })
      if (!result.available || !result.contentBase64) throw new Error('Attachment is unavailable')
      const mime = safeAttachmentMime(result.mime || attachment.mime)
      const inferred = artifactPreviewDefinition(result.name || attachment.name).kind
      setViewer({
        url: `data:${mime};base64,${result.contentBase64}`,
        item: { path: result.name || attachment.name, size: result.size || attachment.size, content_type: mime, kind: inferred === 'office' ? 'binary' : inferred },
      })
    } catch { setAvailable(false) }
    finally { setOpening(false) }
  }

  const persisted = Boolean(attachment.storageRef)
  return <><article className={`message-attachment-card${persisted ? ' is-persisted' : ''}`}>
    <button type="button" className="message-attachment-open" disabled={!persisted || !available || opening} aria-busy={opening} onClick={() => void openAttachment()} title={persisted ? `Abrir ${attachment.name} no visualizador do Wharnex` : `${attachment.name} · anexo histórico sem cópia persistida`}>
      <AttachmentVisual preview={preview} name={attachment.name} />
      <span className="message-attachment-copy"><b>{attachment.name}</b><small>{opening ? 'A abrir no Wharnex…' : `${formatBytes(attachment.size)}${attachment.mime ? ` · ${attachment.mime}` : ''}`}</small></span>
    </button>
    <button type="button" className="message-attachment-index" onClick={() => requestArtifactIndex('chat', attachment.name)} title="Indexar no próximo prompt" aria-label={`Indexar ${attachment.name} no composer`}><Icon name="link" size={12}/></button>
  </article>{viewer && <ArtifactViewerModal directURL={viewer.url} items={[viewer.item]} initialIndex={0} onClose={() => setViewer(undefined)}/>}</>
}

export function ComposerAttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const preview = useLocalImagePreview(file)
  return <span className="composer-attachment-chip" title={`${file.name} · ${formatBytes(file.size)}`}>
    <AttachmentVisual preview={preview} name={file.name} />
    <span className="composer-attachment-copy"><b>{file.name}</b><small>{formatBytes(file.size)}</small></span>
    <button type="button" aria-label={`Remover ${file.name}`} onClick={onRemove}>×</button>
  </span>
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

function safeAttachmentMime(value?: string) {
  const mime = String(value || '').trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : 'application/octet-stream'
}

function extension(name: string) {
  const value = name.split('.').pop()?.trim().toUpperCase() || 'FILE'
  return value.length <= 5 ? value : 'FILE'
}
