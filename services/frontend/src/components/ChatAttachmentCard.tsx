import { useEffect, useMemo, useState } from 'react'
import type { ChatAttachmentInfo } from '../types'
import { desktopBridge } from '../lib/desktop'
import { formatBytes } from '../lib/desktop'
import { Icon } from './Icon'

export function MessageAttachmentCard({ attachment }: { attachment: ChatAttachmentInfo }) {
  const [preview, setPreview] = useState('')
  const [available, setAvailable] = useState(Boolean(attachment.storageRef))

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
    if (!attachment.storageRef) return
    const bridge = desktopBridge()
    if (!bridge) return
    try { await bridge.attachments.open({ storageRef: attachment.storageRef }) } catch { setAvailable(false) }
  }

  const persisted = Boolean(attachment.storageRef)
  return <button
    type="button"
    className={`message-attachment-card${persisted ? ' is-persisted' : ''}`}
    disabled={!persisted || !available}
    onClick={() => void openAttachment()}
    title={persisted ? `Abrir ${attachment.name}` : `${attachment.name} · anexo histórico sem cópia persistida`}
  >
    <AttachmentVisual preview={preview} name={attachment.name} />
    <span className="message-attachment-copy"><b>{attachment.name}</b><small>{formatBytes(attachment.size)}{attachment.mime ? ` · ${attachment.mime}` : ''}</small></span>
  </button>
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

function extension(name: string) {
  const value = name.split('.').pop()?.trim().toUpperCase() || 'FILE'
  return value.length <= 5 ? value : 'FILE'
}
