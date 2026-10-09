import { inflateRawSync } from 'node:zlib'
import { safeEntryName } from '../chat-input-zip-writer.mjs'
import { selectArchiveContextEntries } from '../chat-input-context-selection.mjs'

// Physical roots of the request archive. The backend context bundle still
// uses the legacy logical namespaces, which are remapped here.
export const PRIMARY_CONTEXT_ROOT = 'context/'
export const REFERENCE_CONTEXT_ROOT = 'ref-context/'
export const ATTACHED_CONTEXT_ROOT = 'att-context/'
export const CONTEXT_MAP_ROOT = 'context-map/'
export const CONTEXT_SOURCES_INDEX = 'metadata/context-sources.json'
const LEGACY_CONTEXT_SOURCES_INDEX = 'RELATED_PROJECTS.json'
const LEGACY_RELATED_CONTEXT_ROOT = 'RELATED_PROJECTS/'
const LEGACY_ATTACHED_CONTEXT_ROOT = 'ATTACHMENTS/'
const EXECUTION_RULE = 'context/ contains only the primary project snapshot. ref-context/ contains related project snapshots whose write authority is controlled by the request grant. att-context/ contains read-only external @attach material and is never a patch target. context-map/ contains generated path inventory, deterministic semantic guidance with byte/round budget metadata, and redacted sensitive configuration key-state metadata; semantic ranking is advisory and context-map/ is never a patch target.'

export const CONTEXT_ROOTS_NOTICE = `REQUEST ARCHIVE CONTEXT ROOTS (Wharnex-owned transport metadata):\n- ${PRIMARY_CONTEXT_ROOT} contains only the primary project snapshot.\n- ${REFERENCE_CONTEXT_ROOT}<project>/ contains @ref related-project snapshots.\n- ${ATTACHED_CONTEXT_ROOT}attach-<slot>/ contains read-only @attach material.\n- ${CONTEXT_MAP_ROOT} contains generated path inventories and redacted sensitive configuration key-state maps for main/@ref; it is metadata only and never a patch target.\n- ${CONTEXT_SOURCES_INDEX} maps source roots and write authority.\nIf an older persisted prompt mentions RELATED_PROJECTS or ATTACHMENTS, those are legacy logical namespace names; open the physical roots above in this archive.`

export function contextRootsManifest(included) {
  return {
    primary: included ? PRIMARY_CONTEXT_ROOT : '',
    references: included ? REFERENCE_CONTEXT_ROOT : '',
    attached_paths: included ? ATTACHED_CONTEXT_ROOT : '',
    maps: included ? CONTEXT_MAP_ROOT : '',
    sources_index: included ? CONTEXT_SOURCES_INDEX : '',
  }
}

function attachmentRoot(prefix) {
  const clean = String(prefix || '').replace(/^\/+|\/+$/g, '').replace(/^ATTACHMENTS\//, '')
  const segment = clean.split('/')[0] || '01'
  const dash = segment.indexOf('-')
  const slot = dash > 0 ? segment.slice(0, dash) : segment
  return `${ATTACHED_CONTEXT_ROOT}attach-${slot || '01'}/`
}

function physicalEntryName(name, workspace) {
  if (!workspace) return `${PRIMARY_CONTEXT_ROOT}${name}`
  if (name === LEGACY_CONTEXT_SOURCES_INDEX) return CONTEXT_SOURCES_INDEX
  if (name.startsWith(LEGACY_RELATED_CONTEXT_ROOT)) return `${REFERENCE_CONTEXT_ROOT}${name.slice(LEGACY_RELATED_CONTEXT_ROOT.length)}`
  if (!name.startsWith(LEGACY_ATTACHED_CONTEXT_ROOT)) return `${PRIMARY_CONTEXT_ROOT}${name}`
  const relative = name.slice(LEGACY_ATTACHED_CONTEXT_ROOT.length)
  const slash = relative.indexOf('/')
  const segment = slash >= 0 ? relative.slice(0, slash) : relative
  const suffix = slash >= 0 ? relative.slice(slash + 1) : ''
  const prefix = attachmentRoot(`${LEGACY_ATTACHED_CONTEXT_ROOT}${segment}/`)
  return suffix ? `${prefix}${suffix}` : prefix.slice(0, -1)
}

function rewriteContextSourcesIndex(bytes) {
  let document
  try { document = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('Context sources index is malformed') }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Context sources index is malformed')
  document.protocol = 'harness.context-sources/v1'
  if (Array.isArray(document.related_projects)) {
    document.related_projects = document.related_projects.map((project) => ({
      ...project, prefix: `${REFERENCE_CONTEXT_ROOT}${String(project?.prefix || '').replace(/^RELATED_PROJECTS\//, '')}`,
    }))
  }
  if (Array.isArray(document.attached_paths)) {
    document.attached_paths = document.attached_paths.map((attachment) => ({ ...attachment, prefix: attachmentRoot(attachment?.prefix) }))
  }
  document.execution_rule = EXECUTION_RULE
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

function findZipEnd(buffer) {
  const floor = Math.max(0, buffer.byteLength - 0xffff - 22)
  for (let offset = buffer.byteLength - 22; offset >= floor; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('Context archive has no valid ZIP directory')
}

// Reads the backend context ZIP under explicit extraction bounds: no symlinks,
// no encryption, deflate/store only, bounded entry and expanded sizes.
function readContextZip(buffer) {
  const end = findZipEnd(buffer)
  const count = buffer.readUInt16LE(end + 10)
  const centralOffset = buffer.readUInt32LE(end + 16)
  if (!count || count > 20000 || centralOffset >= end) throw new Error('Context archive directory is invalid')
  const entries = []
  let offset = centralOffset
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Context archive directory is malformed')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const externalAttributes = buffer.readUInt32LE(offset + 38)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
    const normalized = safeEntryName(name.replace(/\/$/, '')).name
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) throw new Error(`Context archive symlink is forbidden: ${normalized}`)
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error('Encrypted context entries are forbidden')
    if (method !== 0 && method !== 8) throw new Error(`Unsupported context compression method: ${method}`)
    if (size > 32 << 20 || (compressedSize && size / compressedSize > 200)) throw new Error(`Context entry exceeds safe extraction bounds: ${normalized}`)
    if (localOffset + 30 > buffer.byteLength || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Context archive local entry is malformed')
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize)
    if (compressed.byteLength !== compressedSize) throw new Error('Context archive entry is truncated')
    const bytes = method === 8 ? inflateRawSync(compressed, { maxOutputLength: size + 1 }) : Buffer.from(compressed)
    if (bytes.byteLength !== size) throw new Error(`Context entry size mismatch: ${normalized}`)
    total += size
    if (total > 256 << 20) throw new Error('Expanded context exceeds 256 MiB')
    entries.push({ name: normalized, bytes })
  }
  return entries
}

function flattenContextEntries(buffer) {
  const entries = readContextZip(buffer)
  const workspace = entries.some((entry) => entry.name === LEGACY_CONTEXT_SOURCES_INDEX)
  return entries.map((entry) => ({
    name: physicalEntryName(entry.name, workspace),
    bytes: workspace && entry.name === LEGACY_CONTEXT_SOURCES_INDEX ? rewriteContextSourcesIndex(entry.bytes) : entry.bytes,
  }))
}

export function normalizeContextMapFiles(values) {
  const list = Array.isArray(values) ? values : []
  if (!list.length || list.length > 128) throw new Error('Invalid context map inventory')
  const seen = new Set()
  let total = 0
  return list.map((item) => {
    const name = safeEntryName(String(item?.path || '').trim()).name
    if (!name.startsWith(CONTEXT_MAP_ROOT) || seen.has(name)) throw new Error('Invalid context map path')
    seen.add(name)
    const bytes = Buffer.from(String(item?.content || ''), 'utf8')
    total += bytes.byteLength
    if (!bytes.byteLength || bytes.byteLength > (4 << 20) || total > (16 << 20)) throw new Error('Context maps exceed safe archive bounds')
    return { name, bytes }
  })
}

// The selected context snapshot entries followed by its generated maps.
export function contextArchiveEntries(context) {
  if (!context?.bytes) return []
  const maps = normalizeContextMapFiles(context.maps)
  return [...selectArchiveContextEntries(flattenContextEntries(context.bytes), context), ...maps]
}
