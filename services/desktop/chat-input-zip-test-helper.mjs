import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'

export function storedEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const expandedSize = buffer.readUInt32LE(offset + 22)
    const nameBytes = buffer.readUInt16LE(offset + 26)
    const extraBytes = buffer.readUInt16LE(offset + 28)
    assert.ok(method === 0 || method === 8)
    const nameStart = offset + 30
    const dataStart = nameStart + nameBytes + extraBytes
    const name = buffer.subarray(nameStart, nameStart + nameBytes).toString('utf8')
    const encoded = buffer.subarray(dataStart, dataStart + compressedSize)
    const content = method === 8 ? inflateRawSync(encoded) : encoded
    assert.equal(content.length, expandedSize)
    entries.set(name, content)
    offset = dataStart + compressedSize
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50)
  assert.equal(buffer.readUInt32LE(buffer.byteLength - 22), 0x06054b50)
  return entries
}
