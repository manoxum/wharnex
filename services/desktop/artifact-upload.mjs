import { request as httpRequest } from 'node:http'
import { currentTrace, TRACE_HEADER } from './operational-trace.mjs'

const MAX_RESPONSE_BYTES = 64 * 1024
export const ARTIFACT_UPLOAD_TIMEOUT_MS = 60_000
let uploadTail = Promise.resolve()

// Large request bundles must reach the local backend without depending on the
// Desktop's shared fetch connection pool. The server replies with only record
// metadata, so its response is bounded independently of the upload size.
export function uploadChatArtifact(backendURL, sessionId, artifact, signal, options = {}) {
  const upload = uploadTail.then(() => performChatArtifactUpload(backendURL, sessionId, artifact, signal, options))
  uploadTail = upload.catch(() => undefined)
  return upload
}

function performChatArtifactUpload(backendURL, sessionId, artifact, signal, { timeoutMs = ARTIFACT_UPLOAD_TIMEOUT_MS } = {}) {
  const target = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, backendURL)
  const body = Buffer.from(JSON.stringify({
    request_id: String(artifact.requestId || '').trim(),
    direction: artifact.direction,
    kind: artifact.kind,
    filename: artifact.filename,
    content_type: artifact.contentType || 'application/octet-stream',
    content_base64: Buffer.from(artifact.bytes).toString('base64'),
  }))
  const headers = { 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength), Connection: 'close' }
  const trace = currentTrace()
  if (trace) headers[TRACE_HEADER] = trace

  let timer
  return new Promise((resolve, reject) => {
    const request = httpRequest(target, { method: 'POST', headers, signal, agent: false }, (response) => {
      const chunks = []
      let received = 0
      response.on('data', (chunk) => {
        received += chunk.byteLength
        if (received > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Artifact persistence response exceeds 64 KiB'))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        let result
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reject(new Error(`Artifact persistence HTTP ${response.statusCode}: invalid response`)); return }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const code = String(result?.error?.code || '').trim()
          const detail = String(result?.error?.message || `Artifact persistence HTTP ${response.statusCode}`)
          reject(new Error(code ? `${code}: ${detail}` : detail))
          return
        }
        resolve(result)
      })
    })
    request.on('error', reject)
    timer = setTimeout(() => request.destroy(new Error(`Artifact persistence exceeded ${timeoutMs} ms (sent ${request.socket?.bytesWritten || 0}/${body.byteLength} bytes)`)), timeoutMs)
    request.end(body)
  }).finally(() => clearTimeout(timer))
}
