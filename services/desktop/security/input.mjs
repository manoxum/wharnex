// Boundary validation for identifiers, attachments and geometry that arrive
// over IPC from the renderer.

export function sanitizeSessionId(value) {
  const id = String(value || '')
  if (!/^[a-zA-Z0-9_-]{3,160}$/.test(id)) throw new Error('Invalid Wharnex session id')
  return id
}

export function sanitizeChatCacheKey(value) {
  const key = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error('Invalid ChatGPT cache key')
  return key
}

// Runtime projections legitimately have empty slots between scheduler claims.
// Preserve that absence while applying the strict cache-key boundary to every
// non-empty value; callers must not weaken sanitizeChatCacheKey itself.
export function sanitizeOptionalChatCacheKey(value) {
  const key = String(value || '').trim()
  return key ? sanitizeChatCacheKey(key) : ''
}

export function sanitizeAttachmentFilename(value) {
  const name = String(value || '').normalize('NFC').trim()
  if (!name || name === '.' || name === '..' || name.length > 180) throw new Error('Invalid attachment filename')
  if (/[\\/\u0000-\u001f\u007f<>:"|?*]/.test(name) || name.endsWith('.')) throw new Error('Invalid attachment filename')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid attachment filename')
  return name
}

export function decodeUserAttachment(value, maxBytes) {
  if (!value || typeof value !== 'object') throw new Error('Invalid attachment')
  const name = sanitizeAttachmentFilename(value.name)
  const source = String(value.contentBase64 || '')
  if (!source || !/^[A-Za-z0-9+/]*={0,2}$/.test(source) || source.length % 4 !== 0) throw new Error(`Attachment ${name} has invalid base64 content`)
  const bytes = Buffer.from(source, 'base64')
  const mime = String(value.mime || '').trim().toLowerCase()
  if (mime.length > 120 || (mime && !/^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+$/.test(mime))) throw new Error(`Attachment ${name} has invalid MIME type`)
  if (!bytes.byteLength) throw new Error(`Attachment ${name} is empty`)
  if (bytes.byteLength > maxBytes) throw new Error(`Attachment ${name} exceeds the size limit`)
  if (bytes.toString('base64') !== source) throw new Error(`Attachment ${name} has non-canonical base64 content`)
  return { name, bytes, mime: mime || 'application/octet-stream' }
}

export function chatInputSettleDelay(bytes, attachmentCount) {
  const safeBytes = Math.max(0, Number(bytes) || 0)
  const safeCount = Math.max(0, Math.floor(Number(attachmentCount) || 0))
  const megabytes = Math.ceil(safeBytes / (1024 * 1024))
  return Math.min(30_000, 1_500 + safeCount * 350 + megabytes * 200)
}

export function normalizeBounds(value, area) {
  if (!value || !area || area.width < 1 || area.height < 1) return null
  const rawX = Math.floor(Number(value.x) || 0)
  const rawY = Math.floor(Number(value.y) || 0)
  const x = Math.max(0, Math.min(rawX, area.width - 1))
  const y = Math.max(0, Math.min(rawY, area.height - 1))
  const width = Math.max(1, Math.min(Math.floor(Number(value.width) || 1), area.width - x))
  const height = Math.max(1, Math.min(Math.floor(Number(value.height) || 1), area.height - y))
  return { x, y, width, height }
}

export function sanitizeDiagnosticURL(value) {
  try {
    const url = new URL(String(value))
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '<invalid-url>'
  }
}
