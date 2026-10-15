import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readBoundedArchive } from '../transport/archive/reader.mjs'

export async function retainLogicalInput(input, directory, requestId) {
  let bytes
  if (!input.multipart) bytes = await readFile(input.archivePath)
  else {
    const parts = []
    for (const item of input.parts) {
      const entries = readBoundedArchive(await readFile(item.path))
      const payload = entries.find((entry) => entry.name === 'multipart/payload.part')
      if (!payload) throw new Error('Parte do bundle Codex incompleta.')
      parts.push(payload.bytes)
    }
    bytes = Buffer.concat(parts)
    if (bytes.length !== input.multipart.payload_bytes || createHash('sha256').update(bytes).digest('hex') !== input.multipart.payload_sha256) throw new Error('Integridade do bundle Codex inválida.')
  }
  const filename = path.join(directory, `${requestId}-input.zip`)
  await writeFile(filename, bytes, { mode: 0o600 })
  return filename
}
