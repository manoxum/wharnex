import { request as httpRequest } from 'node:http'
import { currentTrace, TRACE_HEADER } from '../../observability/operational-trace.mjs'

const MAX_RESULT_BYTES = 16 << 20
// Backend writes are bounded at 30 minutes. Give the Worker a shorter,
// explicit bound without Node fetch's five-minute response-header deadline.
export const WORKER_BUNDLE_BACKEND_TIMEOUT_MS = 29 * 60 * 1000

export function postLongRunningWorkerJSON(baseURL, path, body, timeoutMs = WORKER_BUNDLE_BACKEND_TIMEOUT_MS) {
  const target = new URL(path, baseURL)
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('Long-running Worker requests require a local backend')
  }
  const input = Buffer.from(JSON.stringify(body))
  const headers = { 'Content-Type': 'application/json', 'Content-Length': input.length }
  const trace = currentTrace()
  if (trace) headers[TRACE_HEADER] = trace
  return new Promise((resolve, reject) => {
    const request = httpRequest(target, { method: 'POST', headers }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_RESULT_BYTES) {
          request.destroy(new Error('Orchestrator Worker backend response exceeds 16 MiB'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`orchestrator Worker worker-bundle HTTP ${response.statusCode}${result?.error?.message ? `: ${String(result.error.message)}` : ''}`))
          } else resolve(result)
        } catch (error) { reject(error) }
      })
      response.on('error', reject)
    })
    const timer = setTimeout(() => request.destroy(new Error('Orchestrator Worker bundle delivery exceeded the backend deadline')), timeoutMs)
    request.on('error', reject)
    request.on('close', () => clearTimeout(timer))
    request.end(input)
  })
}
