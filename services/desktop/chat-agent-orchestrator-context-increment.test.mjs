import assert from 'node:assert/strict'
import test from 'node:test'
import { orchestratorContextIncrementPaths, rearmOrchestratorPlanDownload, sendOrchestratorContextIncrement } from './chat-agent-orchestrator-context-increment.mjs'
import { contextSelectionFromSession } from './chat-input-context-selection.mjs'

const increment = (paths) => ({ delivery_status: 'context_increment', context_paths: paths })

test('a context increment resends only when the selection grows', () => {
  assert.equal(orchestratorContextIncrementPaths({ plan: { id: 'p' } }, []), undefined)
  assert.deepEqual(orchestratorContextIncrementPaths(increment(['context/a.go']), []), ['context/a.go'])
  assert.deepEqual(orchestratorContextIncrementPaths(increment(['context/a.go', 'context/b.go']), ['context/a.go']), ['context/a.go', 'context/b.go'])
  // Re-downloading the card that asked for these files grants nothing new.
  assert.equal(orchestratorContextIncrementPaths(increment(['context/a.go']), ['context/a.go']), null)
})

test('a re-armed plan download accepts only a card newer than the resubmission', async () => {
  const expected = { lastClickAt: 42, downloadStarted: true, assistantBaseline: 1 }
  const download = rearmOrchestratorPlanDownload(expected, 5, 1000)
  assert.equal(expected.freshOnly, true)
  assert.equal(expected.assistantBaseline, 5)
  assert.equal(expected.lastClickAt, 0)
  assert.equal(expected.downloadStarted, false)
  assert.equal(expected.armedAt, 1000)
  expected.resolve('bytes')
  assert.equal(await download, 'bytes')
})

test('a context increment is sent in order and checkpointed with its selection', async () => {
  const calls = []
  const runtime = {
    fetchContext: async () => { calls.push('fetch'); return { bytes: Buffer.from('zip'), maps: [] } },
    writeRequest: async (context) => { calls.push(`write:${context.mode}:${context.paths.join(',')}`); return { bootstrap: 'boot' } },
    persistRequest: async () => { calls.push('persist'); throw new Error('storage offline') },
    warn: (message) => calls.push(`warn:${message}`),
    pace: async () => calls.push('pace'),
    fill: async (bootstrap, label) => { calls.push(`${label}:${bootstrap}`); return true },
    attach: async () => calls.push('attach'),
    assistantCount: async () => 7,
    submit: async () => calls.push('submit'),
    checkpoint: async (values) => calls.push(`checkpoint:${values.assistant_baseline}:${values.context_paths.join(',')}`),
  }
  const expected = {}
  const sent = await sendOrchestratorContextIncrement(runtime, expected, ['context/a.go'])
  assert.equal(sent.assistantBaseline, 7)
  assert.equal(expected.freshOnly, true)
  assert.deepEqual(calls, [
    'fetch', 'write:partial:context/a.go', 'persist', 'warn:context increment archive not persisted: storage offline', 'pace',
    'orchestrator-context-fill:boot', 'attach', 'orchestrator-context-refill:boot', 'submit', 'checkpoint:7:context/a.go',
  ])
})

test('an unavailable composer fails the increment before anything is submitted', async () => {
  const runtime = {
    fetchContext: async () => ({}), writeRequest: async () => ({ bootstrap: 'b' }), persistRequest: async () => {},
    warn: () => {}, pace: async () => {}, fill: async () => false, attach: async () => assert.fail('attach'),
    assistantCount: async () => 0, submit: async () => assert.fail('submit'), checkpoint: async () => assert.fail('checkpoint'),
  }
  await assert.rejects(sendOrchestratorContextIncrement(runtime, {}, ['context/a.go']), /composer unavailable/)
})

test('the session decides Full or Partial and never blocks a send over the request id', () => {
  assert.deepEqual(contextSelectionFromSession({}), { mode: 'full', paths: [] })
  assert.deepEqual(contextSelectionFromSession({ context_mode: 'full', context_paths: ['context/a'] }), { mode: 'full', paths: [] })
  assert.deepEqual(contextSelectionFromSession({ context_mode: 'partial' }), { mode: 'partial', paths: [] })
  assert.deepEqual(contextSelectionFromSession({ context_mode: 'partial', context_paths: ['context/a'], last_request_id: 'other' }), { mode: 'partial', paths: ['context/a'] })
})
