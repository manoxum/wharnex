import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { decodeUserAttachment } from '../../../security/security.mjs'

const DEFAULT_CHAT_ATTACHMENT_COUNT_LIMIT = 0
const DEFAULT_REQUEST_BUNDLE_TOTAL_BYTES = 100 * 1024 * 1024
const DEFAULT_REQUEST_BUNDLE_PART_BYTES = 30 * 1024 * 1024
const DEFAULT_REQUEST_BUNDLE_PART_LIMIT = 10
const MAX_CHAT_ARTIFACTS = 4
const MAX_CHAT_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_CHAT_ARTIFACTS_BYTES = 6 * 1024 * 1024
const SAFE_ATTACHMENT_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])
const MAX_ATTACHMENT_THUMBNAIL_SOURCE_BYTES = 8 * 1024 * 1024

export function createChatGPTAttachmentTools({ backendURL, userDataPath, nativeImage, getFileIcon, fetchImpl = fetch }) {
  async function fetchChatTransportLimits(signal) {
    const target = new URL('/api/artifact-settings', backendURL)
    const response = await fetchImpl(target, { redirect: 'error', signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body?.error?.message || `Artifact settings HTTP ${response.status}`)
    const attachmentCountLimit = Math.max(0, Math.trunc(Number(body?.attachment_count_limit ?? DEFAULT_CHAT_ATTACHMENT_COUNT_LIMIT)))
    const totalBytes = Math.max(1 << 20, Math.trunc(Number(body?.request_bundle_total_bytes || DEFAULT_REQUEST_BUNDLE_TOTAL_BYTES)))
    const partBytes = Math.max(1 << 20, Math.trunc(Number(body?.request_bundle_part_bytes || DEFAULT_REQUEST_BUNDLE_PART_BYTES)))
    const partLimit = Math.max(1, Math.min(20, Math.trunc(Number(body?.request_bundle_part_limit || DEFAULT_REQUEST_BUNDLE_PART_LIMIT))))
    return { attachmentCountLimit, totalBytes, partBytes, partLimit }
  }

  function decodeChatAttachmentSet(values, limits) {
    if (!Array.isArray(values)) throw new Error('Chat attachments must be an array')
    if (limits.attachmentCountLimit > 0 && values.length > limits.attachmentCountLimit) throw new Error(`At most ${limits.attachmentCountLimit} chat attachments are allowed by the configured limit`)
    // There is deliberately no fixed per-file attachment cap. An individual
    // file can consume the whole logical request budget; the final archive size
    // is checked after prompt, context and attachments have been assembled.
    const decoded = values.map((value) => decodeUserAttachment(value, limits.totalBytes))
    const names = new Set()
    let total = 0
    for (const attachment of decoded) {
      const portableName = attachment.name.toLocaleLowerCase('en-US')
      if (names.has(portableName)) throw new Error(`Duplicate attachment filename: ${attachment.name}`)
      names.add(portableName)
      total += attachment.bytes.byteLength
    }
    if (total > limits.totalBytes) throw new Error('Chat attachments alone exceed the configured request bundle total limit')
    return { decoded, total }
  }

  function decodeChatArtifactSet(values) {
    if (!Array.isArray(values) || values.length > MAX_CHAT_ARTIFACTS) throw new Error(`At most ${MAX_CHAT_ARTIFACTS} Wharnex artifacts are allowed`)
    const decoded = values.map((value) => decodeUserAttachment(value, MAX_CHAT_ARTIFACT_BYTES))
    const names = new Set()
    let total = 0
    for (const artifact of decoded) {
      const portableName = artifact.name.toLocaleLowerCase('en-US')
      if (names.has(portableName)) throw new Error(`Duplicate Wharnex artifact filename: ${artifact.name}`)
      names.add(portableName)
      total += artifact.bytes.byteLength
    }
    if (total > MAX_CHAT_ARTIFACTS_BYTES) throw new Error('Wharnex artifacts exceed the 6 MiB total limit')
    return { decoded, total }
  }

  async function createPersistentAttachmentPreview(sourcePath, targetPath, mime, sourceBytes) {
    const safeRaster = SAFE_ATTACHMENT_IMAGE_MIMES.has(String(mime || '').toLowerCase()) && Number(sourceBytes || 0) <= MAX_ATTACHMENT_THUMBNAIL_SOURCE_BYTES
    let image = safeRaster ? nativeImage.createFromPath(sourcePath) : nativeImage.createEmpty()
    let kind = 'thumbnail'
    if (image.isEmpty()) {
      image = await getFileIcon(sourcePath, { size: 'large' })
      kind = 'icon'
    }
    if (image.isEmpty()) return 'none'
    const size = image.getSize()
    const scale = Math.min(1, 180 / Math.max(1, size.width), 120 / Math.max(1, size.height))
    if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
    await writeFile(targetPath, image.toPNG(), { mode: 0o600 })
    return kind
  }

  function chatAttachmentRoot() {
    return path.join(userDataPath(), 'chat-attachments-v1')
  }

  return { fetchChatTransportLimits, decodeChatAttachmentSet, decodeChatArtifactSet, createPersistentAttachmentPreview, chatAttachmentRoot }
}
