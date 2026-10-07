import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { createOutputRedactor } from './redaction.mjs'

export function captureStartup(command, args, { file, environment = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const redact = createOutputRedactor(environment)
  let entries = []
  let writes = Promise.resolve()
  let timer
  const save = () => {
    timer = undefined
    const batch = entries
    entries = []
    if (!file || !batch.length) return writes
    const text = batch.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    writes = writes.then(() => appendFile(file, text, { mode: 0o600 })).catch(() => {})
    return writes
  }
  const record = (stream, message) => {
    entries.push({ stream, source: basename(command), text: redact(message), at: new Date().toISOString() })
    if (!timer) timer = setTimeout(save, 80)
  }
  const child = spawn(command, args, { env: { ...environment, WHARNEX_SPLASH_CAPTURE_ACTIVE: '1' }, stdio: ['inherit', 'pipe', 'pipe'] })
  for (const [name, target] of [['stdout', stdout], ['stderr', stderr]]) {
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let truncated = false
    child[name].on('data', (chunk) => {
      target.write(chunk)
      const lines = (pending + decoder.write(chunk)).split(/\r\n|[\r\n]/)
      pending = lines.pop()
      for (const line of lines) { record(name, truncated ? '[Linha de saída demasiado longa]' : line); truncated = false }
      // Keep partial lines bounded without publishing a split credential.
      if (pending.length > 8192) { if (!truncated) redact(pending); pending = ''; truncated = true }
    })
    child[name].on('end', () => {
      const final = pending + decoder.end()
      if (truncated) record(name, '[Linha de saída demasiado longa]')
      else if (final) record(name, final)
    })
  }
  return new Promise((resolve) => {
    const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => [signal, () => child.kill(signal)]))
    for (const [signal, handler] of handlers) process.on(signal, handler)
    child.on('error', (error) => { stderr.write(`${command}: ${error.message}\n`); record('stderr', error.message) })
    child.on('close', async (code, signal) => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
      clearTimeout(timer); await save()
      resolve(code < 0 ? 127 : code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1))
    })
  })
}
