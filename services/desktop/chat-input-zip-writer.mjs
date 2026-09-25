import { isUtf8 } from 'node:buffer'
import { open, rm } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'

const UTF8_FLAG = 0x0800
const STORE_METHOD = 0
const DEFLATE_METHOD = 8
const DOS_DATE_1980_01_01 = 0x0021
const MAX_ZIP32 = 0xffffffff

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

export function safeEntryName(value) {
  const name = String(value || '').normalize('NFC')
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\u0000')) throw new Error('Invalid chat input archive path')
  const parts = name.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid chat input archive path')
  const raw = Buffer.from(name, 'utf8')
  if (raw.byteLength > 0xffff) throw new Error('Chat input archive path is too long')
  return { name, raw }
}

async function writeAll(handle, buffer, position, signal) {
  let written = 0
  while (written < buffer.byteLength) {
    if (signal?.aborted) throw signal.reason || new Error('Chat input archive preparation was cancelled')
    const result = await handle.write(buffer, written, buffer.byteLength - written, position + written)
    if (!result.bytesWritten) throw new Error('Could not write chat input archive')
    written += result.bytesWritten
  }
  return position + written
}

function encodeEntry(name, data) {
  // The multipart manifest is intentionally stored for the existing bounded
  // manifest reader; the payload is already a ZIP and is never recompressed.
  if (name === 'transport.json' || name === 'multipart/payload.part' || !data.length || !isUtf8(data) || data.includes(0)) {
    return { method: STORE_METHOD, encoded: data }
  }
  const compressed = deflateRawSync(data, { level: 6 })
  if (compressed.length >= data.length || data.length > compressed.length * 200) return { method: STORE_METHOD, encoded: data }
  return { method: DEFLATE_METHOD, encoded: compressed }
}

export async function writeChatInputZip(targetPath, entries, signal) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 0xffff) throw new Error('Invalid chat input archive entries')
  const names = new Set()
  const central = []
  let position = 0
  const handle = await open(targetPath, 'wx', 0o600)
  try {
    for (const entry of entries) {
      const { name, raw: nameRaw } = safeEntryName(entry?.name)
      const key = name.toLocaleLowerCase('en-US')
      if (names.has(key)) throw new Error(`Duplicate chat input archive path: ${name}`)
      names.add(key)
      const data = Buffer.isBuffer(entry?.bytes) ? entry.bytes : Buffer.from(entry?.bytes || '')
      const { method, encoded } = encodeEntry(name, data)
      if (data.length > MAX_ZIP32 || encoded.length > MAX_ZIP32 || position > MAX_ZIP32) throw new Error('Chat input archive exceeds ZIP32 limits')
      const checksum = crc32(data)
      const localOffset = position
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(UTF8_FLAG, 6)
      header.writeUInt16LE(method, 8)
      header.writeUInt16LE(0, 10)
      header.writeUInt16LE(DOS_DATE_1980_01_01, 12)
      header.writeUInt32LE(checksum, 14)
      header.writeUInt32LE(encoded.length, 18)
      header.writeUInt32LE(data.length, 22)
      header.writeUInt16LE(nameRaw.length, 26)
      position = await writeAll(handle, header, position, signal)
      position = await writeAll(handle, nameRaw, position, signal)
      position = await writeAll(handle, encoded, position, signal)
      central.push({ nameRaw, checksum, method, compressed: encoded.length, bytes: data.length, localOffset })
    }

    const centralOffset = position
    for (const entry of central) {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(UTF8_FLAG, 8)
      header.writeUInt16LE(entry.method, 10)
      header.writeUInt16LE(0, 12)
      header.writeUInt16LE(DOS_DATE_1980_01_01, 14)
      header.writeUInt32LE(entry.checksum, 16)
      header.writeUInt32LE(entry.compressed, 20)
      header.writeUInt32LE(entry.bytes, 24)
      header.writeUInt16LE(entry.nameRaw.length, 28)
      header.writeUInt32LE(entry.localOffset, 42)
      position = await writeAll(handle, header, position, signal)
      position = await writeAll(handle, entry.nameRaw, position, signal)
    }

    const centralSize = position - centralOffset
    if (position > MAX_ZIP32 || centralOffset > MAX_ZIP32 || centralSize > MAX_ZIP32) throw new Error('Chat input archive exceeds ZIP32 limits')
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(central.length, 8)
    end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(centralOffset, 16)
    position = await writeAll(handle, end, position, signal)
    await handle.sync()
    return position
  } catch (error) {
    try { await handle.close() } catch { /* cleanup below */ }
    await rm(targetPath, { force: true }).catch(() => {})
    throw error
  } finally {
    try { await handle.close() } catch { /* already closed on error */ }
  }
}
