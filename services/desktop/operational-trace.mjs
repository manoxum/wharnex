import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

// One trace id per Desktop operation — a scheduler task attempt or a request
// preparation — carried through every await, sent to the backend in
// X-Wharnex-Trace and stamped on every console line (adr/ADR-0075). It lets a
// `[chatgpt-upload]` line be joined with the exact backend calls it caused.
export const TRACE_HEADER = 'X-Wharnex-Trace'

const storage = new AsyncLocalStorage()
const SAFE = /[^A-Za-z0-9:_.-]/g

export function traceId(...parts) {
  const id = parts.map((part) => String(part ?? '').replace(SAFE, '')).filter(Boolean).join(':')
  return (id || `trc_${randomUUID()}`).slice(0, 120)
}

export function currentTrace() {
  return storage.getStore() || ''
}

// Runs fn inside a trace. An enclosing trace is kept, so nested operations
// stay attributed to the operation that started them.
export function withTrace(id, fn) {
  if (currentTrace()) return fn()
  return storage.run(traceId(id), fn)
}

export function traceForTask(task) {
  return traceId('task', task?.task_id, task?.attempt)
}

// Adds the current trace to calls addressed to the local backend only.
export function installBackendTraceHeader(target, backendURL) {
  const origin = new URL(backendURL).origin
  const original = target.fetch
  if (typeof original !== 'function') return
  target.fetch = function tracedFetch(input, init = {}) {
    const trace = currentTrace()
    let url
    try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url) } catch { return original.call(this, input, init) }
    if (!trace || url.origin !== origin) return original.call(this, input, init)
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    if (!headers.has(TRACE_HEADER)) headers.set(TRACE_HEADER, trace)
    return original.call(this, input, { ...init, headers })
  }
}
