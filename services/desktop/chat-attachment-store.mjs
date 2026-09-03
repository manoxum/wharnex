import { lstat, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MANIFEST = 'manifest.json'
const MAX_MANIFEST_BYTES = 256 * 1024

export async function persistChatAttachmentFiles(root, cacheKey, messageId, attachments, createPreview) {
  const chatDir = path.join(root, cacheKey)
  const messageDir = path.join(chatDir, messageId)
  await rm(messageDir, { recursive: true, force: true })
  await mkdir(messageDir, { recursive: true, mode: 0o700 })

  const records = []
  try {
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index]
      const stem = String(index).padStart(2, '0')
      const filename = `${stem}-${attachment.name}`
      const filePath = path.join(messageDir, filename)
      await writeFile(filePath, attachment.bytes, { mode: 0o600, flag: 'wx' })

      const previewFilename = `${stem}-preview.png`
      const previewPath = path.join(messageDir, previewFilename)
      let previewKind = 'none'
      try { previewKind = await createPreview(filePath, previewPath, attachment.mime, attachment.bytes.byteLength) || 'none' } catch { previewKind = 'none' }

      records.push({
        index,
        name: attachment.name,
        size: attachment.bytes.byteLength,
        mime: attachment.mime || 'application/octet-stream',
        filename,
        previewFilename: previewKind === 'none' ? '' : previewFilename,
        previewKind,
      })
    }
    await writeFile(path.join(messageDir, MANIFEST), JSON.stringify({ version: 1, records }), { mode: 0o600 })
  } catch (error) {
    await rm(messageDir, { recursive: true, force: true })
    throw error
  }
  return records.map((record) => ({
    name: record.name,
    size: record.size,
    mime: record.mime,
    storageRef: `${cacheKey}/${messageId}/${record.index}`,
    previewKind: record.previewKind,
  }))
}

export async function readStoredAttachmentPreview(root, storageRef) {
  const resolved = await resolveStoredAttachment(root, storageRef)
  if (!resolved.record.previewFilename) return { available: true, dataUrl: '', previewKind: 'none' }
  const previewPath = path.join(resolved.messageDir, safeStoredFilename(resolved.record.previewFilename))
  await assertRegularFile(previewPath)
  const bytes = await readFile(previewPath)
  return { available: true, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, previewKind: resolved.record.previewKind }
}

export async function storedAttachmentPath(root, storageRef) {
  const resolved = await resolveStoredAttachment(root, storageRef)
  const filePath = path.join(resolved.messageDir, safeStoredFilename(resolved.record.filename))
  await assertRegularFile(filePath)
  return filePath
}

export async function removeStoredChatAttachments(root, cacheKey) {
  await rm(path.join(root, cacheKey), { recursive: true, force: true })
}

export function parseStoredAttachmentRef(value) {
  const parts = String(value || '').split('/')
  if (parts.length !== 3) throw new Error('Invalid stored attachment reference')
  const [cacheKey, messageId, rawIndex] = parts
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(cacheKey) || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) throw new Error('Invalid stored attachment reference')
  if (!/^(?:0|[1-9][0-9]?)$/.test(rawIndex)) throw new Error('Invalid stored attachment reference')
  return { cacheKey, messageId, index: Number(rawIndex) }
}

async function resolveStoredAttachment(root, storageRef) {
  const parsed = parseStoredAttachmentRef(storageRef)
  const messageDir = path.join(root, parsed.cacheKey, parsed.messageId)
  const manifestPath = path.join(messageDir, MANIFEST)
  await assertRegularFile(manifestPath)
  const handle = await open(manifestPath, 'r')
  try {
    const stat = await handle.stat()
    if (stat.size < 2 || stat.size > MAX_MANIFEST_BYTES) throw new Error('Stored attachment manifest is invalid')
    const manifest = JSON.parse(await handle.readFile({ encoding: 'utf8' }))
    const record = Array.isArray(manifest?.records) ? manifest.records.find((item) => item?.index === parsed.index) : undefined
    if (!record || typeof record.filename !== 'string') throw new Error('Stored attachment does not exist')
    safeStoredFilename(record.filename)
    if (record.previewFilename) safeStoredFilename(record.previewFilename)
    return { messageDir, record }
  } finally { await handle.close() }
}

function safeStoredFilename(value) {
  const filename = String(value || '')
  if (!filename || filename === '.' || filename === '..' || path.basename(filename) !== filename || /[\\/\u0000-\u001f\u007f]/.test(filename)) throw new Error('Stored attachment manifest contains an invalid filename')
  return filename
}

async function assertRegularFile(filePath) {
  const stat = await lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Stored attachment is not a regular file')
}
