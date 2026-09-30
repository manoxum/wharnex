import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { TRACE_HEADER, currentTrace, installBackendTraceHeader, traceForTask, traceId, withTrace } from './operational-trace.mjs'

test('trace ids are sanitized, bounded and never empty', () => {
  assert.equal(traceId('task', 'cat_1', 2), 'task:cat_1:2')
  assert.equal(traceId('bad id\n', 'x'), 'badid:x')
  assert.match(traceId(), /^trc_/)
  assert.ok(traceId('x'.repeat(500)).length <= 120)
  assert.equal(traceForTask({ task_id: 'cat_9', attempt: 3 }), 'task:cat_9:3')
})

test('a trace survives awaits and an enclosing operation keeps ownership', async () => {
  assert.equal(currentTrace(), '')
  await withTrace('task:cat_1:1', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1))
    assert.equal(currentTrace(), 'task:cat_1:1')
    await withTrace('prepare:req_1', async () => assert.equal(currentTrace(), 'task:cat_1:1'))
  })
  assert.equal(currentTrace(), '')
})

test('only calls to the local backend carry the trace header', async () => {
  const seen = []
  const target = { fetch: async (input, init = {}) => { seen.push([String(input), new Headers(init.headers).get(TRACE_HEADER)]); return { ok: true } } }
  installBackendTraceHeader(target, 'http://127.0.0.1:6969')
  await target.fetch('http://127.0.0.1:6969/api/health')
  await withTrace('task:cat_2:1', async () => {
    await target.fetch('http://127.0.0.1:6969/api/sessions/ses_1/bundle')
    await target.fetch('https://chatgpt.com/backend-api/conversation')
    await target.fetch('http://127.0.0.1:6969/api/x', { headers: { [TRACE_HEADER]: 'explicit' } })
  })
  assert.deepEqual(seen, [
    ['http://127.0.0.1:6969/api/health', null],
    ['http://127.0.0.1:6969/api/sessions/ses_1/bundle', 'task:cat_2:1'],
    ['https://chatgpt.com/backend-api/conversation', null],
    ['http://127.0.0.1:6969/api/x', 'explicit'],
  ])
})

test('main traces every scheduler attempt and every transport preparation', async () => {
  const source = await readFile(new URL('../main.mjs', import.meta.url), 'utf8')
  const context = await readFile(new URL('../lifecycle/startup/context.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../lifecycle/startup/runtime.mjs', import.meta.url), 'utf8')
  const transport = await readFile(new URL('../chatgpt/transport/requests/transport-preparation.mjs', import.meta.url), 'utf8')
  assert.match(source, /startDesktopRuntime\(createDesktopStartupContext\(\{/)
  for (const [factory, invocation] of [
    ['createWorkerScheduler', /worker\.create\(\{ \.\.\.worker\.options, workerHost \}\)/],
    ['createTranslatorScheduler', /translator\.create\(translator\.options\)/],
    ['createSupervisorScheduler', /supervisor\.create\(supervisor\.options\)/],
  ]) {
    assert.match(context, new RegExp(`create: ${factory}`))
    assert.match(runtime, invocation)
  }
  for (const [file, executor] of [
    ['translator', 'executeEphemeralWorkerTask'],
    ['supervisor', 'executeChatSupervisorTask'],
  ]) {
    const scheduler = await readFile(new URL(`../agent/scheduling/startup/${file}.mjs`, import.meta.url), 'utf8')
    assert.match(scheduler, new RegExp(`execute: \\(task, context\\) => withTrace\\(traceForTask\\(task\\), \\(\\) => ${executor}\\(task, context\\)\\)`))
  }
  // Worker attempts are traced first, then scoped for their activity phase.
  const worker = await readFile(new URL('../agent/scheduling/startup/worker.mjs', import.meta.url), 'utf8')
  assert.match(worker, /execute: \(task, context\) => withTrace\(traceForTask\(task\), \(\) => chatAgentWorkerActivity\.run\([^\n]*executeChatAgentTask\(task, context\)\)\)/)
  assert.match(transport, /return await withTrace\(traceId\('prepare', requestId \|\| key, Date\.now\(\)\.toString\(36\)\), operation\)/)
  assert.match(source, /withTrace,\s*traceId,/)
  assert.match(source, /installConsoleCapture\(console, operationalLog, \{ trace: currentTrace \}\)\ninstallBackendTraceHeader\(globalThis, BACKEND_URL\)/)
})
