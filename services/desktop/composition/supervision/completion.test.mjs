import { readResponseSource } from './response-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('task-scoped Keep flowing survives WAITING and ends when that task is terminal', async () => {
  const source = await readResponseSource()
  const sponsorship = await readFile(new URL('../../agent/scheduling/capacity/keep-flowing.mjs', import.meta.url), 'utf8')
  const projection = await readFile(new URL('../../agent/supervision/runtime-projection.mjs', import.meta.url), 'utf8')
  const snapshot = await readFile(new URL('../../agent/supervision/runtime-snapshot.mjs', import.meta.url), 'utf8')
  assert.match(sponsorship, /taskEnabled\(runtime\?\.task\)/)
  assert.match(sponsorship, /lastResult\?\.status[\s\S]*=== 'waiting'/)
  assert.match(sponsorship, /taskEnabled\(runtime\?\.lastTask\)/)
  assert.match(sponsorship, /sponsored\(runtime\)/)
  assert.match(source, /chatAgentKeepFlowingActive: keepFlowing\.active/)
  assert.match(snapshot, /chatAgentKeepFlowingActive\(worker\) \|\| pinnedTaskId \? 'claimed' : 'idle'/)
  assert.match(projection, /keep_flowing: task\.keep_flowing === true/)
})

test('retrying a prepared ChatGPT prompt recognizes an already-delivered response before consulting a stale retryable draft', async () => {
  const source = await readResponseSource()
  const start = source.indexOf('async function retryPreparedChatGPTPrompt(')
  const fn = source.slice(start, source.indexOf('\nasync function attachContextToChatGPT', start))

  // The already-delivered check must run unconditionally, before the function
  // ever looks at retryableChatGPTPrompts. Its TTL is independent of whether a
  // round trip already completed, so gating this check behind "no retryable
  // draft exists" let a still-live draft win the race: the composer sent
  // "Entrega ao ChatGPT pendente" and a retry click replayed the full
  // submission against a request ChatGPT had already answered.
  const deliveredCheckIndex = fn.indexOf('recentlyDeliveredChatGPTBundleRequestId(requestId)')
  const retryableGetIndex = fn.indexOf('retryableChatGPTPrompts.get(key)')
  assert.notEqual(deliveredCheckIndex, -1)
  assert.notEqual(retryableGetIndex, -1)
  assert.ok(deliveredCheckIndex < retryableGetIndex, 'the delivered-bundle check must precede reading the retryable draft')
  assert.match(fn, /alreadyDelivered: true/)
})

test('a settling bundle delivery stands the supervision back at the observation cadence', async () => {
  const source = await readResponseSource()
  const start = source.indexOf('async function superviseChatAgentResponse(')
  const fn = source.slice(start, source.indexOf('\nasync function executeChatSupervisorTask', start))

  // DOM_DOWNLOAD_POLL_MS paces reading a live page for a file card. Driving the
  // durable queue with it re-claimed this supervision every two seconds for the
  // whole length of an apply — a claim, a start and a settle per cycle, each
  // republishing the runtime state, which is what made the owning Supervisor's
  // card flicker continuously while a bundle was being applied.
  const pendingIndex = fn.indexOf('pendingChatGPTBundleDeliveries.has(expected.requestId)')
  assert.notEqual(pendingIndex, -1)
  const branch = fn.slice(pendingIndex, fn.indexOf('}', pendingIndex) + 1)
  assert.match(branch, /delayMs: CHAT_AGENT_AWAIT_PROBE_MS/)
  assert.doesNotMatch(fn, /DOM_DOWNLOAD_POLL_MS/)
})

test('a held Supervisor reports as occupied rather than as available between observations', async () => {
  const fn = await readFile(new URL('../../agent/supervision/runtime-snapshot.mjs', import.meta.url), 'utf8')

  // Supervision spends almost all of its life between observations with the
  // lease handed back. Deriving the status from the lease alone painted a slot
  // that is demonstrably mid-request as free on every cycle.
  assert.match(fn, /: hold \? 'claimed'\s*\n\s*: entry \? 'idle' : 'stopped'/)
  assert.match(fn, /occupied: Boolean\(own\.task \|\| hold\)/)
  assert.match(fn, /project_id: chatAgentAgentProject\(own\.task, own\.lastTask, Boolean\(hold\)\)/)
})

// A navigation can expose its trusted target URL before its document finishes
// loading. Treating that URL alone as success leaves the native ChatGPT pane
// indefinitely beneath the local loading cover: the first-load retry must
// recover a still-loading renderer as well.
test('initial Supervisor navigation retries when a trusted URL remains loading', async () => {
  const source = await readFile(new URL('../../chatgpt/session/views/navigation.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("if (reason === 'initial-show') {")
  assert.notEqual(start, -1)
  const retry = source.slice(start, source.indexOf('\n    return operation', start))

  assert.match(retry, /if \(entry\.navigationPromise !== operation \|\| wc\.isDestroyed\(\) \|\| \(!wc\.isLoading\(\) && isTrustedChatGPTOrigin\(wc\.getURL\(\)\)\)\) return/)
})

test('a task request whose supervision raised attention reads as ended, not as still owned', async () => {
  const source = await readResponseSource()
  const supervision = source.slice(source.indexOf('async function orchestratorRequestSupervision('))
  const body = supervision.slice(0, supervision.indexOf('\n}\n'))
  // The durable queue is read before the in-memory expectation.
  assert.ok(body.indexOf('chatAgentScheduler.list') < body.indexOf('expectedChatGPTBundles.get'))
  assert.match(body, /if \(latest && latest\.status !== 'DONE'\) return \{ state: 'ended'/)
  const send = source.slice(source.indexOf('async function sendOrchestratorMainRequest('))
  assert.match(send.slice(0, 600), /disarmExpectedChatGPTBundle\(key, current\.request_id\)\n\s+clearChatGPTHumanAction\(key,/)
  // A task has no workspace chat to update.
  assert.match(source, /if \(key\.startsWith\('otk_'\)\) return ''/)
})

test('supervision reads an idle reloaded conversation whose last turn is the answer as complete', async () => {
  const source = await readResponseSource()
  const probe = source.slice(source.indexOf('async function probeChatAgentResponse('))
  const body = probe.slice(0, probe.indexOf('\nasync function ', 10))
  assert.match(body, /completion\.lastRole === 'assistant'[\s\S]{0,200}<= Number\(expected\.assistantBaseline \|\| 0\)/)
  assert.match(body, /expected\.assistantBaseline = Number\(completion\.assistantCount\) - 1\n\s+completion\.complete = true/)
  // The rebase happens before the thinking/stall decisions read the completion.
  assert.ok(body.indexOf('baseline-rebased') < body.indexOf('if (completion?.thinking === true)'))
  // A task's pinned Worker returns to its conversation instead of standing back forever.
  assert.match(body, /if \(orchestratorTaskChat\(task\)\) \{\n\s+await paceChatGPTWorkerNavigation\(\)\n\s+await loadOwnedChatGPTURL\(key, entry, conversationURL, 'orchestrator-task-return'\)/)
})

test('before judging a page silent, supervision looks for the exact response ZIP anywhere', async () => {
  const source = await readResponseSource()
  const probe = source.slice(source.indexOf('async function probeChatAgentResponse('))
  const body = probe.slice(0, probe.indexOf('\nasync function ', 10))
  const search = body.indexOf('chatGPTExpectedDownloadScript(expected.filename, 0, false, true)')
  assert.ok(search > 0 && search < body.indexOf('AWAIT_STALL_ATTENTION_MS'))
  assert.match(body, /\[chatgpt-supervision\] stall key=/)
})
