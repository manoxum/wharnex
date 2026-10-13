import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { readBoundedArchive } from '../transport/archive/reader.mjs'
import { safeEntryName, writeChatInputZip } from '../transport/chat-input-zip-writer.mjs'

const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false })
const string = { type: 'string' }
export const ARCHIVE_TOOLS = [
  { type: 'function', name: 'wharnex_archive_digest', description: 'Compute SHA-256 and byte length of exact UTF-8 content for response manifests. No execution or filesystem access.', inputSchema: object({ content: string }, ['content']) },
  { type: 'function', name: 'wharnex_archive_read', description: 'Read only the current request ZIP. Omit path to list entries; use offset and limit to page UTF-8 text. No host paths.',
    inputSchema: object({ path: string, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 65536 } }, []) },
  { type: 'function', name: 'wharnex_archive_create', description: 'Create the exact expected response ZIP from complete model-authored UTF-8 entries. Include every manifest and artifact required by the bundled prompt. Does not execute or apply anything.',
    inputSchema: object({ entries: { type: 'array', maxItems: 2000, items: object({ path: string, content: string }, ['path', 'content']) } }, ['entries']) },
]

export function createArchiveTools({ inputPath, outputRoot, expectedFilename, onCreated }) {
  let entries
  let created = false
  const response = (value) => ({ success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] })
  return async function call(tool, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid archive arguments')
    if (tool === 'wharnex_archive_digest') {
      if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 8 << 20) throw new Error('Invalid digest input')
      return response({ sha256: createHash('sha256').update(args.content, 'utf8').digest('hex'), bytes: Buffer.byteLength(args.content) })
    }
    if (tool === 'wharnex_archive_read') {
      entries ??= readBoundedArchive(await readFile(inputPath))
      if (!args.path) {
        const offset = Number.isInteger(args.offset) && args.offset >= 0 ? args.offset : 0
        return response({ entries: entries.slice(offset, offset + 200).map(({ name, bytes }) => ({ path: name, bytes: bytes.length })), nextOffset: offset + 200 < entries.length ? offset + 200 : null })
      }
      const name = safeEntryName(args.path).name
      const entry = entries.find((item) => item.name === name)
      if (!entry) throw new Error('Entry is not in the current request archive')
      const offset = Number.isInteger(args.offset) && args.offset >= 0 ? args.offset : 0
      const limit = Math.min(65536, Math.max(1, Number(args.limit) || 65536))
      if (!isUtf8(entry.bytes)) {
        if (entry.bytes.length > 4 << 20 || !/\.(png|jpe?g|webp)$/i.test(name)) throw new Error('Binary entry cannot be read as text')
        const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'
        return { success: true, contentItems: [{ type: 'inputImage', imageUrl: `data:${mime};base64,${entry.bytes.toString('base64')}` }] }
      }
      const content = entry.bytes.toString('utf8')
      return response({ path: name, content: content.slice(offset, offset + limit), nextOffset: offset + limit < content.length ? offset + limit : null })
    }
    if (tool !== 'wharnex_archive_create' || created) throw new Error('Archive operation is unavailable')
    if (!Array.isArray(args.entries) || !args.entries.length || args.entries.length > 2000) throw new Error('Invalid response entry count')
    let total = 0
    const output = args.entries.map((entry) => {
      if (typeof entry?.content !== 'string') throw new Error('Response entries must contain UTF-8 text')
      const name = safeEntryName(entry.path).name
      if (/^[A-Za-z]:/.test(name)) throw new Error('Absolute response path is forbidden')
      const bytes = Buffer.from(entry.content)
      total += bytes.length
      if (bytes.length > 8 << 20 || total > 24 << 20) throw new Error('Response archive exceeds safe bounds')
      return { name, bytes }
    })
    // No arbitrary output path or shell is ever exposed to the model.
    const outputPath = path.join(outputRoot, expectedFilename)
    await writeChatInputZip(outputPath, output)
    created = true
    await onCreated(outputPath)
    return response({ filename: expectedFilename, created: true, validation: 'pending-backend' })
  }
}
