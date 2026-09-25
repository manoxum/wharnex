import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { boundedTransportSignal, requestPreparationTimer, withRequestPreparationDeadline } from './chatgpt-request-preparation.mjs'

const mainSource = () => readFile(new URL('./main.mjs', import.meta.url), 'utf8')
const sliceFunction = (source, name, next) => {
  const start = source.indexOf(name)
  assert.notEqual(start, -1, `${name} must exist`)
  return source.slice(start, source.indexOf(next, start + name.length))
}

test('a stalled local preparation fails at its own deadline instead of the 300 s socket default', async () => {
  const started = Date.now()
  await assert.rejects(
    withRequestPreparationDeadline(undefined, (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }), { timeoutMs: 20 }),
    /preparação local do bundle excedeu .* sem ter contactado o ChatGPT/,
  )
  assert.ok(Date.now() - started < 2_000)
})

test('an operator cancellation is propagated unchanged and never reported as a timeout', async () => {
  const user = new AbortController()
  const cancellation = new Error('WHARNEX_REQUEST_CANCELLED')
  const pending = withRequestPreparationDeadline(user.signal, (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(cancellation), { once: true })
  }), { timeoutMs: 5_000 })
  user.abort()
  await assert.rejects(pending, (error) => error === cancellation)

  const bounded = boundedTransportSignal(user.signal, 5_000)
  assert.equal(bounded.signal.aborted, true)
  assert.equal(bounded.timedOut(), false)
  bounded.dispose()
})

test('each preparation phase is logged with an absolute timestamp and its own duration', () => {
  const lines = []
  let clock = Date.parse('2026-09-25T16:55:12.000Z')
  const timer = requestPreparationTimer('req_1', { log: (line) => lines.push(line), now: () => clock })
  clock += 1_500
  timer.phase('archive', 'bytes=10')
  clock += 250
  timer.phase('upload')
  assert.deepEqual(lines, [
    '[chatgpt-prepare] at=2026-09-25T16:55:13.500Z request=req_1 phase=archive phaseMs=1500 totalMs=1500 bytes=10',
    '[chatgpt-prepare] at=2026-09-25T16:55:13.750Z request=req_1 phase=upload phaseMs=250 totalMs=1750',
  ])
})

test('request preparation never publishes to, waits for or links a tunnel', async () => {
  const source = await mainSource()
  assert.doesNotMatch(source, /\/remote-input/, 'Desktop must not call the remote-input publication endpoints')
  assert.doesNotMatch(source, /tunnelInstanceIds/)
  const prepare = sliceFunction(source, 'async function preparePromptForChatGPT(', '\nasync function queuePreparedPromptForWorker')
  assert.match(prepare, /withRequestPreparationDeadline\(signal, \(bounded\) => materializeChatInput\(/)
  assert.match(prepare, /localChatInputBootstrap\(requestId, input\.archiveName, expectedFilename, \[\], /)
  const fill = sliceFunction(source, 'async function fillBundledChatGPTComposer(', '\nasync function executeChatGPTDOMScript')
  assert.match(fill, /withRequestPreparationDeadline\(signal, \(bounded\) => materializeProtocolChatInput\(/)
  assert.match(fill, /localChatInputBootstrap\(requestId, input\.archiveName, expectedFilename, \[\], /)
})
