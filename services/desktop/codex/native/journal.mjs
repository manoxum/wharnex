import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createOutputRedactor } from '../../splash/output/redaction.mjs'

export function createNativeJournal(root, { archive = async () => {} } = {}) {
  const redact = createOutputRedactor(process.env, { maxLength: 65536 })
  const secrets = new Set()
  let writes = Promise.resolve()
  function sanitize(value, key = '') {
    if (/^(?:environment|env|password|passwd|token|secret|authorization|cookie|credential|api[_-]?key)$/i.test(key)) return '[REDACTED]'
    if (typeof value === 'string') {
      // A native tool may print its environment. Do not retain that inventory.
      if ((value.match(/^[A-Z_][A-Z0-9_]*=.*/gm) || []).length >= 3) return '[REDACTED ENVIRONMENT]'
      for (const secret of secrets) value = value.split(secret).join('[REDACTED]')
      return redact(value)
    }
    if (Array.isArray(value)) return value.map((item) => sanitize(item))
    if (value?.type === 'reasoning') return { id: value.id, type: 'reasoning', summary: sanitize(value.summary || []) }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]))
    return value
  }
  function append(record, method, params) {
    const event = sanitize({ at: new Date().toISOString(), chatId: record.chatId, sessionId: record.sessionId, requestId: record.requestId, threadId: record.threadId, method, params })
    // Console capture ships metadata asynchronously to the classified log.
    console.info(`[codex] native event=${method} chat=${record.chatId} session=${record.sessionId} request=${record.requestId}`)
    const operation = writes.then(async () => {
      await mkdir(path.join(root, 'history'), { recursive: true, mode: 0o700 })
      await appendFile(path.join(root, 'history', `${record.requestId}.jsonl`), `${JSON.stringify(event)}\n`, { mode: 0o600 })
    })
    writes = operation.catch(() => {})
    return operation
  }
  async function settle(record) {
    await writes
    const bytes = await readFile(path.join(root, 'history', `${record.requestId}.jsonl`))
    await archive(record, { direction: 'output', kind: 'codex_transcript', filename: `whx_codex_${record.requestId}.jsonl`, contentType: 'application/x-ndjson', bytes })
    const prompt = record.messages.find((message) => message.id === record.requestId && message.role === 'user')?.text
    if (prompt) await archive(record, { direction: 'input', kind: 'codex_prompt', filename: `whx_codex_${record.requestId}.md`, contentType: 'text/markdown', bytes: Buffer.from(sanitize(prompt)) })
    for (const [index, file] of (record.attachments || []).entries()) await archive(record, { direction: 'input', kind: 'codex_attachment', filename: `${index + 1}-${file.name}`, contentType: file.mime, bytes: await readFile(file.path) })
  }
  return { append, settle, sanitize, protectSecret: (value) => { if (value) secrets.add(value) }, flush: () => writes }
}
