import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createOperationalLogShipper, installConsoleCapture, parseConsoleLine } from './operational-log.mjs'

const at = new Date('2026-09-25T17:00:14.000Z')

test('a structured Desktop line is classified and correlated without reading prose', () => {
  const record = parseConsoleLine('log', ['[chatgpt-worker-write] queued key=f3ebe00d request=req_20260925T165507_5306 task=cat_a0df'], at)
  assert.deepEqual(
    { event: record.event, level: record.level, chat: record.chat_id, request: record.request_id, task: record.task_id, at: record.occurred_at },
    { event: 'chatgpt-worker-write', level: 'info', chat: 'f3ebe00d', request: 'req_20260925T165507_5306', task: 'cat_a0df', at: at.toISOString() },
  )
  assert.equal(parseConsoleLine('warn', ['[chatgpt-submit] accepted request=1288'], at).request_id, '', 'only canonical request ids correlate')
  assert.equal(parseConsoleLine('error', [new Error('boom')], at).level, 'error')
  assert.equal(parseConsoleLine('log', ['no channel here'], at).event, 'desktop-console')
})

test('captured console lines gain an ISO timestamp and are shipped', () => {
  const written = []
  const shipped = []
  const target = { log: (...args) => written.push(args), warn: (...args) => written.push(args) }
  let trace = ''
  installConsoleCapture(target, { enqueue: (record) => shipped.push(record) }, { now: () => at.getTime(), trace: () => trace })
  target.warn('[chatgpt-upload] retry file=1/1')
  trace = 'task:cat_1:1'
  target.log('[chatgpt-submit] accepted')
  assert.deepEqual(written, [
    [at.toISOString(), '[chatgpt-upload] retry file=1/1'],
    [at.toISOString(), '[chatgpt-submit] accepted', 'trace=task:cat_1:1'],
  ])
  assert.equal(shipped[0].level, 'warning')
  assert.equal(shipped[0].event, 'chatgpt-upload')
  assert.equal(shipped[0].trace_id, '')
  assert.equal(shipped[1].trace_id, 'task:cat_1:1')
})

test('a failing shipper never breaks the logging caller', () => {
  const target = { log: () => undefined }
  installConsoleCapture(target, { enqueue: () => { throw new Error('queue broken') } })
  assert.doesNotThrow(() => target.log('[x] still fine'))
})

test('the shipper batches, keeps records while the backend is down and bounds its queue', async () => {
  const bodies = []
  let available = false
  const shipper = createOperationalLogShipper({
    endpoint: 'http://127.0.0.1/api/operational-log', maxQueue: 3, batchSize: 10, flushMs: 60_000,
    fetchImpl: async (_url, init) => {
      if (!available) throw new Error('backend restarting')
      bodies.push(JSON.parse(init.body).records)
      return { status: 200 }
    },
  })
  for (const n of [1, 2, 3, 4]) shipper.enqueue({ event: `e${n}` })
  await shipper.flush()
  assert.equal(shipper.size(), 3, 'records are kept, bounded, while the backend is unavailable')
  available = true
  await shipper.flush()
  assert.deepEqual(bodies[0].map((record) => record.event), ['e2', 'e3', 'e4', 'desktop-log.records_dropped'])
  assert.equal(shipper.size(), 0)
})

test('main installs the capture before anything else can log', async () => {
  const source = await readFile(new URL('../main.mjs', import.meta.url), 'utf8')
  const backend = source.indexOf('const BACKEND_URL =')
  const install = source.indexOf('installConsoleCapture(console, operationalLog, { trace: currentTrace })')
  assert.ok(backend > 0 && install > backend, 'capture must be installed right after the backend URL is known')
  assert.match(source, /createOperationalLogShipper\(\{ endpoint: new URL\('\/api\/operational-log', BACKEND_URL\)\.href \}\)/)
})
