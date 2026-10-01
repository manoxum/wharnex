import { readTaskExecutionSource } from './task-execution-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('submission pacing widens after rate-limit pressure and decays back on its own', async () => {
  const source = await readTaskExecutionSource()
  const gap = source.slice(source.indexOf('function chatAgentSubmissionGapMs('), source.indexOf('\nasync function paceChatGPTWorkerSubmission('))
  assert.match(gap, /rate_limit_level/)
  assert.match(gap, /CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS/)
  // Healthy provider keeps the floor: a permanent ceiling would serialize the
  // pool long after the account recovered.
  assert.match(gap, /if \(level <= 0 && !recentlyLimited\) return CHAT_AGENT_SUBMIT_GAP_MS/)

  const pace = source.slice(source.indexOf('async function paceChatGPTWorkerRequest('), source.indexOf('async function loadAndSettleChatGPTWorkerConversation('))
  // Measured after the queue wait, never captured before it: several Workers
  // pass their own pre-flight check in the same instant and queue here, the
  // first one through earns the 429, and a value captured on entry would spend
  // the old narrow width for everyone still queued behind it - which is how
  // the burst that caused the rate limit carried straight on through the gate.
  assert.match(pace, /chatGPTWorkerPacer\.pace\(measureGapMs, \{ minimumGapMs, priority \}\)/)
  assert.match(source, /CHAT_AGENT_WORKER_ACTION_GAP_MS,[\s\S]{0,80}ChatAgentGlobalPacer/)
  assert.match(source, /from '\.\/agent\/index\.mjs'/)
  const scheduling = await readFile(new URL('../../agent/scheduling/index.mjs', import.meta.url), 'utf8')
  assert.match(scheduling, /from '\.\/residency\/index\.mjs'/)
  const pacerModule = await readFile(new URL('../../agent/scheduling/residency/chat-agent-pacer.mjs', import.meta.url), 'utf8')
  assert.match(pacerModule, /CHAT_AGENT_WORKER_ACTION_GAP_MS = 10_000/)
  assert.match(pacerModule, /CHAT_AGENT_TRANSLATION_ACTION_GAP_MS = 5_000/)
  assert.match(pace, /paceChatGPTWorkerNavigation\(\)[\s\S]*paceChatGPTWorkerRequest\(chatAgentNavigationGapMs\)/)
  assert.match(pace, /paceChatGPTWorkerSubmission\(\{ translation = false \} = \{\}\)[\s\S]*CHAT_AGENT_TRANSLATION_ACTION_GAP_MS/)

  // A suspension raised while this navigation sat in the queue must stop it:
  // AGENTS.md §8 requires a suspended provider to stop receiving actions, not
  // to receive the ones already in flight. Nothing was attempted, so the task
  // comes back as a free observation instead of spending an attempt.
  const settle = source.slice(source.indexOf('async function loadAndSettleChatGPTWorkerConversation('))
  assert.match(settle.slice(0, 900), /await paceChatGPTWorkerNavigation\(\)[\s\S]*chatAgentRateLimitDelayMs\(\)[\s\S]*throw new ChatGPTRateLimitDeferral/)
  const deferralIndex = settle.indexOf('ChatGPTRateLimitDeferral')
  const loadIndex = settle.indexOf('loadOwnedChatGPTURL(')
  assert.ok(deferralIndex > 0 && loadIndex > deferralIndex, 'the deferral must be checked before the navigation')

  const execute = source.slice(source.indexOf('async function executeChatAgentTask('))
  assert.match(execute.slice(0, 5000), /error instanceof ChatGPTRateLimitDeferral[\s\S]*observation: true/)
})

test('a Desktop restart during a suspension adopts the durable deadline instead of resuming', async () => {
  const source = await readTaskExecutionSource()
  const diagnostics = await readFile(new URL('../../agent/scheduling/diagnostics/refresh.mjs', import.meta.url), 'utf8')
  const start = diagnostics.indexOf('async function refreshChatAgentRuntimeState(')
  const refresh = diagnostics.slice(start)
  assert.match(source, /createChatAgentRuntimeRefresh\(\{/)
  // The local clock is a mirror reset by every restart; the backend owns the
  // cooldown, so the persisted deadline has to be adopted on refresh.
  assert.match(refresh, /provider\?\.paused === true && Number\.isFinite\(pausedUntil\)/)
  assert.match(refresh, /state\.rateLimitUntil = Math\.max\(state\.rateLimitUntil, pausedUntil\)/)
  // Measured: pausing the provider and then resuming it left every worker
  // skipping its claim until a local deadline nobody could see expired. The
  // mirror must follow the durable state down as well as up.
  assert.match(refresh, /else if \(provider\?\.paused === false\) \{[\s\S]*?state\.rateLimitUntil = 0/)
  // A refresh already in flight while a 429 is being persisted still reports
  // paused:false. Obeying it would release the pool into the burst the gate
  // was just raised against, so only a reading that knows about the newest
  // local gate may clear the mirror.
  assert.match(refresh, /observedAt >= state\.rateLimitAppliedAt/)
  const apply = source.slice(source.indexOf('function applyChatGPTRateLimit('), source.indexOf('\nfunction noteChatGPTRateLimitGate('))
  assert.match(apply, /state\.appliedAt = now/)
  assert.match(await readFile(new URL('../../main.mjs', import.meta.url), 'utf8'), /set appliedAt\(value\) \{ desktopState\.chatgpt\.chatGPTRateLimitAppliedAt = value \}/)
})

test('a slot rebound before execution never charges the task attempt budget', async () => {
  const source = await readTaskExecutionSource()
  const start = source.indexOf('async function executeChatAgentTask(')
  const execute = source.slice(start, source.indexOf('\n  switch (task.type)', start))
  // Nothing reached ChatGPT, so AGENTS.md requires this outcome to be free.
  assert.match(execute, /stale worker assignment/i)
  assert.match(execute, /status: 'waiting', observation: true, delayMs: CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS/)
})

test('a Supervisor or Worker whose sticky error clears on the next successful (even empty) claim', async () => {
  const source = await readTaskExecutionSource()

  // Supervisors: chatSupervisorScheduler previously had no onIdle handler at
  // all, so a slot that hit worker-error once and then simply found no more
  // matching work stayed painted "Com erro" forever, even though the very
  // next claim reached the backend fine. onIdle is the only signal proving
  // the loop is healthy again for a slot with nothing currently assigned.
  const supervisorSchedulerStart = source.indexOf('chatSupervisorScheduler = new ChatAgentSchedulerClient(')
  const supervisorScheduler = source.slice(supervisorSchedulerStart, source.indexOf('\n  chatSupervisorScheduler.start()', supervisorSchedulerStart))
  const supervisorOnIdleStart = supervisorScheduler.indexOf('onIdle: (index) => {')
  assert.notEqual(supervisorOnIdleStart, -1, 'chatSupervisorScheduler must define onIdle to clear a stale worker-error')
  const supervisorOnIdle = supervisorScheduler.slice(supervisorOnIdleStart, supervisorScheduler.indexOf('\n    onState:', supervisorOnIdleStart))
  assert.match(supervisorOnIdle, /chatSupervisorStates\.set\(index, \{ \.\.\.prior, error: '' \}\)/)
  assert.match(supervisorOnIdle, /publishChatAgentRuntimeState\(\)/)

  // Workers: the existing onIdle handler released residency but never cleared
  // a prior worker-error, so the same staleness applied to the Worker pool.
  const workerOnIdleStart = source.indexOf('onIdle: (worker) => {')
  const workerOnIdle = source.slice(workerOnIdleStart, source.indexOf('\n    onState:', workerOnIdleStart))
  assert.match(workerOnIdle, /chatAgentWorkerStates\.get\(worker\)/)
  assert.match(workerOnIdle, /chatAgentWorkerStates\.set\(worker, \{ \.\.\.prior, error: '' \}\)/)
})

test('a Worker that finds a Supervisor already supervising stands back at the observation cadence', async () => {
  const source = await readTaskExecutionSource()
  for (const [open, close] of [
    ['async function probeChatAgentResponse(', '\nasync function executeChatAgentTask'],
    ['async function executeChatAgentTask(', '\nfunction chatAgentTaskPayload'],
  ]) {
    const start = source.indexOf(open)
    assert.notEqual(start, -1, open)
    const fn = source.slice(start, source.indexOf(close, start))
    const owned = fn.indexOf('chatGPTSupervisorOwnsExpectedResponse(')
    if (owned === -1) continue
    const branch = fn.slice(owned, fn.indexOf('}', owned) + 1)
    assert.match(branch, /delayMs: CHAT_AGENT_AWAIT_PROBE_MS/, open)
  }
})

// primeChatGPTWorkerPool called an undefined `delay`, which threw as an
// unhandled rejection after creating exactly one worker slot - captured live
// in .harness/logs/desktop.log - silently abandoning the paced startup
// priming loop for every slot after the first.
test('primeChatGPTWorkerPool paces worker creation with a defined helper', async () => {
  const source = await readFile(new URL('../../agent/scheduling/residency/worker-pool.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function primeChatGPTWorkerPool(')
  assert.notEqual(start, -1)
  const fn = source.slice(start, source.indexOf('\n}', start) + 2)

  assert.match(fn, /await wait\(CHAT_AGENT_WORKER_SPAWN_GAP_MS\)/)
  assert.doesNotMatch(fn, /await delay\(/)
})

// Live-observed on a large draining backlog: due-task demand flapped above
// and below zero from one 2s auto-scale poll to the next, so a grow was torn
// back down before its own demand's next tick, then regrown moments later -
// each cycle creating and destroying real WebContentsViews (a navigation to
// chatgpt.com apiece). That churn was severe enough to crash the desktop.
// Both pools must hold a recent grow for a cooldown window before a drain on
// the same tick shape is allowed to act.
test('the worker and supervisor pools cannot drain immediately after growing', async () => {
  const source = await readFile(new URL('../../agent/scheduling/capacity/auto-scale-runtime.mjs', import.meta.url), 'utf8')

  const workerStart = source.indexOf('async function reconcileChatAgentAutoScale(')
  assert.notEqual(workerStart, -1)
  const worker = source.slice(workerStart, source.indexOf('\n  function reconcileChatTranslatorCapacity', workerStart))
  assert.match(worker, /state\.chatAgentWorkerLastGrowAt = Date\.now\(\)/)
  const workerGrowIndex = worker.indexOf('state.chatAgentWorkerLastGrowAt = Date.now()')
  const workerCooldownIndex = worker.indexOf('Date.now() - state.chatAgentWorkerLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS')
  assert.notEqual(workerCooldownIndex, -1)
  assert.ok(workerGrowIndex < workerCooldownIndex, 'worker grow must be recorded before the cooldown check')
  const workerDrainIndex = worker.indexOf('autoScaleDrainTarget(')
  assert.ok(workerCooldownIndex < workerDrainIndex, 'worker cooldown must gate the drain check')

  const supervisorStart = source.indexOf('function reconcileChatAgentSupervisorAutoScale(')
  assert.notEqual(supervisorStart, -1)
  const supervisor = source.slice(supervisorStart)
  assert.match(supervisor, /state\.chatAgentSupervisorLastGrowAt = Date\.now\(\)/)
  const supervisorCooldownIndex = supervisor.indexOf('Date.now() - state.chatAgentSupervisorLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS')
  assert.notEqual(supervisorCooldownIndex, -1)
  const supervisorDrainIndex = supervisor.indexOf('autoScaleSupervisorDrainTarget(')
  assert.ok(supervisorCooldownIndex < supervisorDrainIndex, 'supervisor cooldown must gate the drain check')
})

// publishChatAgentRuntimeState is called from ~26 sites, several of them
// WebContents event handlers that can each fire once per view per
// occurrence; with several ChatGPT views active a busy backlog drain
// produced a burst of these within the same second. The computed state must
// still be returned synchronously (callers that `return` it as their IPC
// response depend on that), but the renderer broadcast is coalesced so a
// burst produces at most one send per window per broadcast window.
test('the runtime state broadcast is coalesced without delaying the returned value', async () => {
  const source = await readTaskExecutionSource()
  const controls = await readFile(new URL('../../agent/scheduling/diagnostics/controls.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatAgentRuntimeControls\(\{/)
  const start = controls.indexOf('function publishChatAgentRuntimeState(')
  assert.notEqual(start, -1)
  const fn = controls.slice(start, controls.indexOf('\n  function pauseChatAgentWorkers(', start))

  assert.match(fn, /const current = getRuntimeState\(\)/)
  assert.match(fn, /latestState = current/)
  assert.match(fn, /if \(!broadcastTimer\) \{/)
  assert.match(fn, /broadcastPending = true/)
  assert.match(fn, /setTimeout\(\(\) => \{[\s\S]*broadcastTimer = undefined/)
  // The synchronous return must not sit inside the deferred branch.
  const returnIndex = fn.lastIndexOf('return current')
  const elseIndex = fn.indexOf('} else {')
  assert.ok(returnIndex > elseIndex, 'return state must follow both branches, not be nested inside one')
})
