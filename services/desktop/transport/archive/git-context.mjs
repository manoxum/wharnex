import { createHash } from 'node:crypto'
import { safeEntryName } from '../chat-input-zip-writer.mjs'

const EMPTY = { protocol: 'harness.git-context/v1', state: 'none', root: 'git-context/', index: '', files: [] }

// Verifies every Git context file against the digest and size the backend
// measured, so the archive carries exactly the repository state it describes.
export function normalizeGitContextSnapshot(value) {
  if (!value || typeof value !== 'object') return EMPTY
  const protocol = String(value.protocol || '').trim()
  const state = String(value.state || '').trim()
  const root = String(value.root || '').trim()
  const index = String(value.index || '').trim()
  if (protocol !== 'harness.git-context/v1' || root !== 'git-context/' || !['present', 'unavailable'].includes(state)) throw new Error('Invalid Git context snapshot')
  const list = Array.isArray(value.files) ? value.files : []
  if (!list.length || list.length > 128) throw new Error('Invalid Git context file inventory')
  const seen = new Set()
  let total = 0
  const files = list.map((entry) => {
    const path = safeEntryName(String(entry?.path || '').trim()).name
    if (!path.startsWith('git-context/') || seen.has(path)) throw new Error('Invalid Git context path')
    seen.add(path)
    const raw = Buffer.from(String(entry?.content || ''), 'utf8')
    total += raw.byteLength
    if (raw.byteLength > (2 << 20) || total > (32 << 20)) throw new Error('Git context exceeds safe archive bounds')
    const sha256 = createHash('sha256').update(raw).digest('hex')
    if (String(entry?.sha256 || '').trim().toLowerCase() !== sha256 || Number(entry?.bytes) !== raw.byteLength) throw new Error(`Git context integrity mismatch: ${path}`)
    return { path, sha256, bytes: raw.byteLength, raw }
  })
  if (!index || !seen.has(index)) throw new Error('Git context index is missing')
  return {
    protocol, state, root, index,
    ref: String(value.ref || '').trim().slice(0, 256),
    ref_path: String(value.ref_path || '').trim().slice(0, 512),
    head_sha: String(value.head_sha || '').trim(),
    upstream: String(value.upstream || '').trim().slice(0, 512),
    has_upstream: Boolean(value.has_upstream),
    ahead: Number(value.ahead || 0),
    behind: Number(value.behind || 0),
    files,
  }
}

export function gitContextManifest(snapshot) {
  return {
    protocol: snapshot.protocol, state: snapshot.state, root: snapshot.root, index: snapshot.index,
    ref: snapshot.ref || '', ref_path: snapshot.ref_path || '', head_sha: snapshot.head_sha || '', upstream: snapshot.upstream || '',
    has_upstream: Boolean(snapshot.has_upstream), ahead: Number(snapshot.ahead || 0), behind: Number(snapshot.behind || 0),
    files: snapshot.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
  }
}

export function gitContextArchiveEntries(snapshot) {
  return snapshot.files.map((entry) => ({ name: entry.path, bytes: entry.raw }))
}
