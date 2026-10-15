import { inflateRawSync } from 'node:zlib'
import { safeEntryName } from '../chat-input-zip-writer.mjs'

function findZipEnd(buffer) {
  const floor = Math.max(0, buffer.byteLength - 0xffff - 22)
  for (let offset = buffer.byteLength - 22; offset >= floor; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('ZIP archive has no valid ZIP directory')
}

// Reads the backend context ZIP under explicit extraction bounds: no symlinks,
// no encryption, deflate/store only, bounded entry and expanded sizes.
export function readBoundedArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > 256 << 20) throw new Error('Invalid ZIP size')
  const end = findZipEnd(buffer)
  const count = buffer.readUInt16LE(end + 10)
  const centralOffset = buffer.readUInt32LE(end + 16)
  if (!count || count > 20000 || centralOffset >= end) throw new Error('ZIP archive directory is invalid')
  const entries = []
  const names = new Set()
  let offset = centralOffset
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP archive directory is malformed')
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
    if (/^[A-Za-z]:/.test(normalized) || names.has(normalized.toLowerCase())) throw new Error('Invalid or duplicate ZIP path')
    names.add(normalized.toLowerCase())
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) throw new Error(`ZIP archive symlink is forbidden: ${normalized}`)
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error('Encrypted context entries are forbidden')
    if (method !== 0 && method !== 8) throw new Error(`Unsupported context compression method: ${method}`)
    if (size > 32 << 20 || (compressedSize && size / compressedSize > 200)) throw new Error(`ZIP entry exceeds safe extraction bounds: ${normalized}`)
    if (localOffset + 30 > buffer.byteLength || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP archive local entry is malformed')
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize)
    if (compressed.byteLength !== compressedSize) throw new Error('ZIP archive entry is truncated')
    const bytes = method === 8 ? inflateRawSync(compressed, { maxOutputLength: size + 1 }) : Buffer.from(compressed)
    if (bytes.byteLength !== size) throw new Error(`ZIP entry size mismatch: ${normalized}`)
    total += size
    if (total > 256 << 20) throw new Error('Expanded context exceeds 256 MiB')
    entries.push({ name: normalized, bytes })
  }
  return entries
}

