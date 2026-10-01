import { readPromptTransportSource } from '../../../composition/transport/prompt-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { REQUEST_PREPARATION_TIMEOUT_MS, boundedChatInputPartBytes, boundedTransportSignal, requestPreparationTimer, withRequestPreparationDeadline } from './chatgpt-request-preparation.mjs'

const mainSource = () => readPromptTransportSource()
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

test('the preparation budget covers sequential large artifact uploads', () => {
  assert.ok(REQUEST_PREPARATION_TIMEOUT_MS >= 4 * 120_000)
})

test('large archives are split into safe local upload sizes within the configured part count', () => {
  const limits = { totalBytes: 100 * 1024 * 1024, partBytes: 30 * 1024 * 1024, partLimit: 10 }
  assert.equal(boundedChatInputPartBytes(limits), 12 * 1024 * 1024)
  assert.ok(Math.ceil(limits.totalBytes / (boundedChatInputPartBytes(limits) - 256 * 1024)) <= limits.partLimit)
  assert.equal(boundedChatInputPartBytes({ ...limits, partBytes: 6 * 1024 * 1024 }), 6 * 1024 * 1024)
})

test('Desktop persists every bounded transport part and uploads all parts to ChatGPT', async () => {
  const source = await mainSource()
  const materialize = sliceFunction(source, 'async function materializeChatInput', '\nasync function materializeProtocolChatInput')
  assert.match(materialize, /const limits = await fetchChatTransportLimits\(signal\)/)
  assert.match(materialize, /writeChatInputTransportArchives\(dir, \{/)
  assert.match(materialize, /maxTotalBytes: limits\.totalBytes, maxPartBytes: boundedChatInputPartBytes\(limits\), maxParts: limits\.partLimit/)
  assert.match(materialize, /for \(const part of transport\.parts\) await persistChatArtifact/)
  const prepare = sliceFunction(source, 'async function preparePromptForChatGPT(', '\nasync function queuePreparedPromptForWorker')
  assert.match(prepare, /input\.uploadPaths\.length/)
  assert.doesNotMatch(prepare, /await pasteChatGPTFile\(target\.entry, input\.archivePath, 1, 1/)
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
