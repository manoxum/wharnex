import { createHash } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { writeChatInputZip } from '../chat-input-zip-writer.mjs'
import { writeChatInputArchive } from './logical.mjs'
import { chatInputArchiveFilename } from './request-identity.mjs'

const PART_PROTOCOL = 'wharness.chat-input-part/v1'
const MULTIPART_WRAPPER_RESERVE_BYTES = 32 * 1024

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('Chat input archive preparation was cancelled')
  error.name = 'AbortError'
  throw error
}

function partName(archiveName, index, count) {
  if (index === 1) return archiveName
  const width = Math.max(2, String(count).length)
  return archiveName.replace(/\.zip$/i, `_part-${String(index).padStart(width, '0')}-of-${String(count).padStart(width, '0')}.zip`)
}

async function sha256File(filePath, signal) {
  const handle = await open(filePath, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(1024 * 1024)
  try {
    for (let position = 0; ;) {
      throwIfAborted(signal)
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position)
      if (!bytesRead) return hash.digest('hex')
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
  } finally { await handle.close() }
}

function transportLimits({ maxTotalBytes, maxPartBytes, maxParts }) {
  const total = Math.trunc(Number(maxTotalBytes || 0))
  const part = Math.trunc(Number(maxPartBytes || 0))
  const count = Math.trunc(Number(maxParts || 0))
  if (total < 1 << 20) throw new Error('Configured request bundle total limit must be at least 1 MiB')
  if (part < 1 << 20) throw new Error('Configured request bundle part limit must be at least 1 MiB')
  if (count < 1 || count > 20) throw new Error('Configured request bundle part count must be between 1 and 20')
  return { total, part, count }
}

async function readChunk(source, offset, length) {
  const chunk = Buffer.alloc(length)
  for (let read = 0; read < length;) {
    const result = await source.read(chunk, read, length - read, offset + read)
    if (!result.bytesRead) throw new Error('Request bundle payload was truncated while splitting')
    read += result.bytesRead
  }
  return chunk
}

// Splits the logical archive into ordered wrapper ZIPs whose payload chunks
// reconstruct it byte for byte; every part stays within the configured limit.
async function writeParts(targetDir, logicalPath, { requestId, archiveName, logicalBytes, chunkBytes, count, partLimit, signal }) {
  const payloadSha256 = await sha256File(logicalPath, signal)
  const source = await open(logicalPath, 'r')
  const parts = []
  try {
    for (let index = 1; index <= count; index += 1) {
      throwIfAborted(signal)
      const offset = (index - 1) * chunkBytes
      const chunk = await readChunk(source, offset, Math.min(chunkBytes, logicalBytes - offset))
      const name = partName(archiveName, index, count)
      const target = `${targetDir}/${name}`
      const manifest = {
        protocol: PART_PROTOCOL, request_id: String(requestId || ''), payload_name: archiveName,
        payload_bytes: logicalBytes, payload_sha256: payloadSha256, part_index: index, part_count: count,
        chunk_offset: offset, chunk_bytes: chunk.byteLength, chunk_sha256: createHash('sha256').update(chunk).digest('hex'), chunk_path: 'multipart/payload.part',
      }
      const readme = `# Wharnex multipart request\n\nPart ${index} of ${count}. Reassemble the request by ordering all parts by part_index and concatenating multipart/payload.part. Verify payload_bytes and payload_sha256 from transport.json before opening ${archiveName}.\n`
      const bytes = await writeChatInputZip(target, [
        { name: 'transport.json', bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
        { name: 'README.md', bytes: Buffer.from(readme, 'utf8') },
        { name: 'multipart/payload.part', bytes: chunk },
      ], signal)
      if (bytes > partLimit) { await rm(target, { force: true }); throw new Error(`Multipart wrapper ${name} exceeds configured part limit`) }
      parts.push({ name, path: target, bytes, index, count })
    }
  } catch (error) {
    for (const part of parts) await rm(part.path, { force: true }).catch(() => {})
    throw error
  } finally {
    await source.close()
  }
  return { parts, payloadSha256 }
}

export async function writeChatInputTransportArchives(targetDir, { chatId, requestId, maxTotalBytes, maxPartBytes, maxParts, ...archiveInput }) {
  const { signal } = archiveInput
  const archiveName = chatInputArchiveFilename(chatId, requestId)
  const limits = transportLimits({ maxTotalBytes, maxPartBytes, maxParts })
  const logicalPath = `${targetDir}/.logical-${archiveName}`
  const logical = await writeChatInputArchive(logicalPath, { requestId, ...archiveInput })
  const summary = { archiveName, logicalBytes: logical.bytes, fileCount: logical.fileCount, requestMetadata: logical.requestMetadata }
  try {
    if (logical.bytes > limits.total) throw new Error(`Request bundle is ${logical.bytes} bytes, above the configured total limit of ${limits.total} bytes`)
    if (logical.bytes <= limits.part) {
      throwIfAborted(signal)
      const archivePath = `${targetDir}/${archiveName}`
      await rename(logicalPath, archivePath)
      return {
        ...summary, archivePath, uploadPaths: [archivePath], uploadNames: [archiveName],
        parts: [{ name: archiveName, path: archivePath, bytes: logical.bytes }], multipart: undefined, bytes: logical.bytes,
      }
    }
    const chunkBytes = limits.part - MULTIPART_WRAPPER_RESERVE_BYTES
    if (chunkBytes < 1) throw new Error('Configured request bundle part limit is too small for multipart metadata')
    const count = Math.ceil(logical.bytes / chunkBytes)
    if (count > limits.count) throw new Error(`Request bundle requires ${count} parts, above the configured maximum of ${limits.count}`)
    const { parts, payloadSha256 } = await writeParts(targetDir, logicalPath, {
      requestId, archiveName, logicalBytes: logical.bytes, chunkBytes, count, partLimit: limits.part, signal,
    })
    return {
      ...summary, archivePath: parts[0].path, uploadPaths: parts.map((part) => part.path), uploadNames: parts.map((part) => part.name), parts,
      multipart: { protocol: PART_PROTOCOL, payload_name: archiveName, payload_bytes: logical.bytes, payload_sha256: payloadSha256, parts: parts.map(({ name, index, count: total }) => ({ name, index, count: total })) },
      bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    }
  } finally {
    await rm(logicalPath, { force: true }).catch(() => {})
  }
}
