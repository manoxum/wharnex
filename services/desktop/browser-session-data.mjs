import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const BROWSER_SESSION_FORMAT = 'wharness.browser-session/v1'
export const MAX_BROWSER_SESSION_EXPORT_BYTES = 512 * 1024 * 1024
export const MAX_BROWSER_SESSION_FILES = 20000

const excludedNames = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache', 'GraphiteDawnCache', 'Crashpad'])

export async function snapshotBrowserSession(root) {
  const files = []
  let bytes = 0
  async function walk(current, relative = '') {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (excludedNames.has(entry.name)) continue
      const rel = relative ? path.posix.join(relative, entry.name) : entry.name
      const full = path.join(current, entry.name)
      const info = await lstat(full)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        await walk(full, rel)
        continue
      }
      if (!info.isFile()) continue
      if (files.length >= MAX_BROWSER_SESSION_FILES) throw new Error('Browser session contains too many files to export safely')
      bytes += info.size
      if (bytes > MAX_BROWSER_SESSION_EXPORT_BYTES) throw new Error('Browser session export exceeds 512 MiB')
      const content = await readFile(full)
      files.push({ path: rel, mode: info.mode & 0o777, content_base64: content.toString('base64') })
    }
  }
  await walk(root)
  return Buffer.from(JSON.stringify({ format: BROWSER_SESSION_FORMAT, created_at: new Date().toISOString(), files }), 'utf8')
}

export async function restoreBrowserSession(root, raw) {
  if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw)
  if (raw.byteLength > MAX_BROWSER_SESSION_EXPORT_BYTES * 1.5) throw new Error('Browser session import is too large')
  let envelope
  try { envelope = JSON.parse(raw.toString('utf8')) } catch { throw new Error('Invalid Wharness browser session file') }
  if (envelope?.format !== BROWSER_SESSION_FORMAT || !Array.isArray(envelope.files)) throw new Error('Unsupported Wharness browser session format')
  if (envelope.files.length > MAX_BROWSER_SESSION_FILES) throw new Error('Browser session import contains too many files')
  const decoded = []
  let bytes = 0
  for (const file of envelope.files) {
    const rel = safeRelativePath(file?.path)
    const content = Buffer.from(String(file?.content_base64 || ''), 'base64')
    bytes += content.byteLength
    if (bytes > MAX_BROWSER_SESSION_EXPORT_BYTES) throw new Error('Browser session import exceeds 512 MiB')
    decoded.push({ rel, content, mode: Number(file?.mode) & 0o777 })
  }
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const file of decoded) {
    const target = path.join(root, ...file.rel.split('/'))
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, file.content, { mode: file.mode || 0o600 })
  }
  return { files: decoded.length, bytes }
}

export async function pathSize(root) {
  let total = 0
  async function walk(current) {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      let info
      try { info = await lstat(full) } catch { continue }
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await walk(full)
      else if (info.isFile()) total += info.size
    }
  }
  await walk(root)
  return total
}

export async function existingFileSize(file) {
  try { return (await stat(file)).size } catch { return 0 }
}

function safeRelativePath(value) {
  const rel = String(value || '').replaceAll('\\', '/')
  if (!rel || rel.startsWith('/') || rel.includes('\0')) throw new Error('Browser session contains an invalid path')
  const normalized = path.posix.normalize(rel)
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('Browser session path traversal rejected')
  return normalized
}
