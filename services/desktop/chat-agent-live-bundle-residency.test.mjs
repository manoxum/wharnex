import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chatAgentLiveBundlePending } from './chat-agent-live-bundle-residency.mjs'

test('only a live bundle observation pins a Worker conversation between claims', () => {
  const waiting = (type, extras = {}) => ({ lastTask: { type }, lastResult: { status: 'waiting', ...extras } })
  assert.equal(chatAgentLiveBundlePending(waiting('AWAIT_RESPONSE')), true)
  for (const type of ['ORCHESTRATOR_PLAN', 'ORCHESTRATOR_EXECUTE']) {
    assert.equal(chatAgentLiveBundlePending(waiting(type, { liveBundlePending: true })), true)
    assert.equal(chatAgentLiveBundlePending(waiting(type)), false)
    assert.equal(chatAgentLiveBundlePending(waiting(type, { liveBundlePending: false })), false)
  }
  assert.equal(chatAgentLiveBundlePending(waiting('TRANSLATE_MARKDOWN', { liveBundlePending: true })), false)
  assert.equal(chatAgentLiveBundlePending({ ...waiting('ORCHESTRATOR_PLAN', { liveBundlePending: true }), error: 'worker failed' }), false)
  assert.equal(chatAgentLiveBundlePending({ lastTask: { type: 'ORCHESTRATOR_PLAN' }, lastResult: { status: 'done', liveBundlePending: true } }), false)
})

test('the scheduler preserves the same Worker lane after a generating observation', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const execution = await readFile(new URL('./chat-agent-orchestrator-execution.mjs', import.meta.url), 'utf8')
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('), source.indexOf('chatAgentScheduler.start()'))
  assert.match(source, /return chatAgentLiveBundlePending\(chatAgentWorkerStates\.get\(Number\(worker\) \|\| 0\)\)/)
  assert.match(source, /status: 'waiting', observation: true, liveBundlePending: true, delayMs: ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS/)
  assert.match(execution, /status: 'waiting', delayMs: 30_000, observation: true, liveBundlePending: true/)
  assert.match(scheduler, /pinResident: chatAgentSupervisingLiveResponse\(worker\)/)
  assert.match(scheduler, /if \(chatAgentSupervisingLiveResponse\(worker\) \|\| chatAgentKeepFlowingActive\(worker\)\) return/)
  assert.match(scheduler, /kind === 'settled'[\s\S]{0,200}lastResult: state\.result/)
})
