import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { PLANNER_FEATURES } from './config.mjs'
import { codexRPCError } from './transport/index.mjs'

const require = createRequire(import.meta.url)
const MAX_FRAME = 32 * 1024 * 1024

// The official package resolves its platform binary; never assume a host CLI.
export function packagedCodexCommand() {
  const root = path.dirname(require.resolve('@openai/codex/package.json'))
  return [process.execPath, path.join(root, 'bin/codex.js')]
}

export class CodexRPC {
  constructor({ command = packagedCodexCommand, cwd, environment = {}, features = PLANNER_FEATURES, configArgs = ['web_search="disabled"'], spawnImpl = spawn, onNotification = () => {}, onRequest = async () => { throw new Error('Unsupported Codex request') }, onExit = () => {} } = {}) {
    Object.assign(this, { command, cwd, environment, features, configArgs, spawnImpl, onNotification, onRequest, onExit })
    this.sequence = 0
    this.pending = new Map()
  }

  async ready() {
    if (!this.initializing) this.initializing = this.start().catch((error) => { this.stop(); this.initializing = undefined; throw error })
    return this.initializing
  }

  async start() {
    const [executable, ...prefix] = this.command()
    this.cwd ||= await mkdtemp(path.join(tmpdir(), 'wharnex-codex-runtime-'))
    await mkdir(this.cwd, { recursive: true, mode: 0o700 })
    const args = [...prefix, 'app-server', '--listen', 'stdio://',
      ...Object.entries(this.features).flatMap(([name, enabled]) => ['-c', `features.${name}=${enabled}`]),
      ...this.configArgs.flatMap((value) => ['-c', value])]
    const child = this.spawnImpl(executable, args, { cwd: this.cwd, env: { ...process.env, ...this.environment, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false })
    this.child = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      if (buffer.length > MAX_FRAME) { this.stop(); return }
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        try { this.receive(JSON.parse(line)) } catch { this.stop(); return }
      }
    })
    // stderr may contain provider credentials; drain it without logging it.
    child.stderr.resume()
    const exited = () => {
      if (this.child !== child) return
      this.child = undefined; this.initializing = undefined
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('O runtime Codex foi interrompido.')) }
      this.pending.clear(); this.onExit()
    }
    child.once('error', exited); child.once('exit', exited)
    await this.call('initialize', { clientInfo: { name: 'wharnex', title: 'Wharnex', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    this.write({ method: 'initialized' })
  }

  write(message) {
    if (!this.child?.stdin.writable) throw new Error('Runtime Codex indisponível.')
    const frame = JSON.stringify(message)
    if (frame.length > MAX_FRAME) throw new Error('Mensagem Codex excede o limite.')
    this.child.stdin.write(`${frame}\n`)
  }

  call(method, params = {}) {
    console.debug('[codex] rpc', { method, thread_id: params.threadId || '', request_id: '', chat_id: '' })
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex: tempo limite em ${method}.`)) }, 30_000)
      this.pending.set(id, { resolve, reject, timer, method })
      try { this.write({ id, method, params }) } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  receive(message) {
    if (message.method && message.id !== undefined) {
      void Promise.resolve().then(() => this.onRequest(message)).then(
        (result) => this.write({ id: message.id, result }),
        () => {
          console.warn('[codex] server request refused', { method: String(message.method).slice(0, 160) })
          this.write({ id: message.id, error: { code: -32601, message: 'Wharnex refuses this operation.' } })
        },
      ).catch(() => {})
      return
    }
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id)
      if (!waiting) return
      clearTimeout(waiting.timer); this.pending.delete(message.id)
      if (message.error) {
        console.warn('[codex] rpc refused', { method: waiting.method, code: Number(message.error.code) || 0 })
        waiting.reject(codexRPCError(waiting.method, message.error))
      }
      else waiting.resolve(message.result)
      return
    }
    if (typeof message.method === 'string') {
      console.debug('[codex] notification', { method: message.method.slice(0, 160), thread_id: message.params?.threadId || '' })
      this.onNotification(message.method, message.params || {})
    }
  }

  stop() {
    const child = this.child
    if (!child) return Promise.resolve()
    return new Promise((resolve) => {
      // EOF lets app-server shut down its Code Mode child and flush state.
      // Await termination before callers remove runtime-owned directories.
      const timer = setTimeout(() => child.kill(), 1000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.once('error', () => { clearTimeout(timer); resolve() })
      child.stdin.end()
    })
  }
}
