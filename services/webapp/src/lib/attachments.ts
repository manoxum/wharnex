import type { RemoteAttachment } from '../types'

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

export async function encodeFiles(files: File[]): Promise<RemoteAttachment[]> {
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    mime: file.type || 'application/octet-stream',
    contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  })))
}
