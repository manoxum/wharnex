import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chatAgentLiveBundlePending } from './chat-agent-live-bundle-residency.mjs'
import { readSchedulerStartupSource } from '../../composition/workers/scheduler-startup-source.mjs'

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
  const source = await readSchedulerStartupSource()
  const planObservation = await readFile(new URL('../orchestration/plan/observation.mjs', import.meta.url), 'utf8')
  const execution = await readFile(new URL('../orchestration/chat-agent-orchestrator-execution.mjs', import.meta.url), 'utf8')
  const workerPool = await readFile(new URL('../scheduling/residency/worker-pool.mjs', import.meta.url), 'utf8')
  const orchestrationRuntime = await readFile(new URL('../../composition/orchestration/runtime.mjs', import.meta.url), 'utf8')
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('), source.indexOf('chatAgentScheduler.start()'))
  assert.match(workerPool, /return chatAgentLiveBundlePending\(chatAgentWorkerStates\.get\(Number\(worker\) \|\| 0\)\)/)
  assert.match(source, /createOrchestrationRuntime\(\{/)
  assert.match(orchestrationRuntime, /observeAgainMs: ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS/)
  assert.match(planObservation, /status: 'waiting', observation: true, liveBundlePending: true, delayMs: observeAgainMs/)
  // An Orchestrator task keeps its Worker through its pin (adr/ADR-0082), so
  // its round driver needs no residency signal of its own.
  assert.match(execution, /served by the Worker pinned to the task/)
  assert.match(scheduler, /pinResident: chatAgentSupervisingLiveResponse\(worker\)/)
  assert.match(scheduler, /if \(chatAgentSupervisingLiveResponse\(worker\) \|\| chatAgentKeepFlowingActive\(worker\)\) return/)
  assert.match(scheduler, /kind === 'settled'[\s\S]{0,200}lastResult: state\.result/)
})
