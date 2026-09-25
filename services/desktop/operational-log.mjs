// Every Desktop console line becomes a timestamped desktop.log line and a
// classified operational record shipped to the backend (adr/ADR-0075).
// Recording must never hurt the work it records: the shipper is bounded,
// times out, never throws and never logs through the console it captures.

const LEVEL_BY_METHOD = { debug: 'debug', log: 'info', info: 'info', warn: 'warning', error: 'error' }
const CHANNEL = /^\[([a-z0-9_-]{1,48})\]\s*([\s\S]*)$/i
const FIELD = /(?:^|\s)([a-zA-Z][a-zA-Z0-9_]{0,31})=([^\s]{1,300})/g
const MAX_FIELDS = 24
const MAX_MESSAGE = 2000

function renderArgument(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}

export function parseConsoleLine(method, args, at = new Date()) {
  const text = args.map(renderArgument).join(' ').trim()
  const match = CHANNEL.exec(text)
  const channel = match ? match[1].toLowerCase() : 'desktop-console'
  const message = (match ? match[2] : text).slice(0, MAX_MESSAGE)
  const fields = {}
  for (const [, key, value] of message.matchAll(FIELD)) {
    if (Object.keys(fields).length >= MAX_FIELDS) break
    fields[key] = value
  }
  const prefixed = (value, prefix) => (typeof value === 'string' && value.startsWith(prefix) ? value : '')
  return {
    source: 'desktop', event: channel, component: channel, level: LEVEL_BY_METHOD[method] || 'info',
    occurred_at: at.toISOString(), message,
    chat_id: fields.key || fields.chat || '',
    request_id: prefixed(fields.request, 'req_') || prefixed(fields.requestId, 'req_'),
    task_id: prefixed(fields.task, 'cat_'),
    data: fields,
  }
}

export function createOperationalLogShipper({
  endpoint, fetchImpl = globalThis.fetch, maxQueue = 2000, batchSize = 200, flushMs = 2000, timeoutMs = 5000,
} = {}) {
  const queue = []
  let dropped = 0
  let timer
  let inflight = false

  function push(record) {
    if (queue.length >= maxQueue) { queue.shift(); dropped += 1 }
    queue.push(record)
  }

  function schedule() {
    if (timer || !queue.length) return
    timer = setTimeout(() => { timer = undefined; void flush() }, flushMs)
    timer.unref?.()
  }

  async function flush() {
    if (inflight || !queue.length) return
    inflight = true
    const batch = queue.splice(0, batchSize)
    if (dropped) {
      batch.push({ source: 'desktop', event: 'desktop-log.records_dropped', level: 'warning', data: { dropped: String(dropped) } })
      dropped = 0
    }
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch }), signal: AbortSignal.timeout(timeoutMs),
      })
      // A rejected batch will be rejected again; only an unavailable backend is retried.
      if (response.status >= 500) throw new Error('operational log unavailable')
    } catch {
      for (const record of batch.reverse()) {
        // The drop marker is regenerated from the counter; requeuing it would
        // take the place of a real record.
        if (record.event === 'desktop-log.records_dropped') { dropped += Number(record.data.dropped) || 0; continue }
        if (queue.length >= maxQueue) { dropped += 1; continue }
        queue.unshift(record)
      }
    } finally {
      inflight = false
      schedule()
    }
  }

  return {
    enqueue(record) { push(record); if (queue.length >= batchSize) void flush(); else schedule() },
    flush,
    size: () => queue.length,
  }
}

export function installConsoleCapture(target, shipper, { now = Date.now, trace = () => '' } = {}) {
  for (const method of Object.keys(LEVEL_BY_METHOD)) {
    const original = typeof target[method] === 'function' ? target[method].bind(target) : undefined
    if (!original) continue
    target[method] = (...args) => {
      const at = new Date(now())
      let current = ''
      try { current = trace() } catch { /* a broken trace source never breaks logging */ }
      original(at.toISOString(), ...args, ...(current ? [`trace=${current}`] : []))
      try { shipper.enqueue({ ...parseConsoleLine(method, args, at), trace_id: current }) } catch { /* recording never breaks the caller */ }
    }
  }
}
