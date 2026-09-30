import { readActivityRecoverySource } from './activity-recovery-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'


test('switching chats reuses a released Supervisor slot and preserves visible intent when recycling', async () => {
  const source = await readActivityRecoverySource()
  const ensureStart = source.indexOf('function ensureChatGPTView(cacheKey, windowState)')
  const ensureEnd = source.indexOf('\nfunction evictIdleChatGPTViews', ensureStart)
  const ensure = source.slice(ensureStart, ensureEnd)

  assert.match(ensure, /chatgptViews\.size >= getDesiredChatAgentSupervisorSlots\(\)/)
  assert.match(await readFile(new URL('../../main.mjs', import.meta.url), 'utf8'), /getDesiredChatAgentSupervisorSlots: \(\) => desiredChatAgentSupervisorSlots/)
  assert.match(ensure, /const reusable = reusableSupervisor\(key, resolved\)/)
  // Eligibility is the whole binding hold, not just an open transport: a chat
  // awaiting its response bundle must not lose its renderer to a chat switch.
  assert.match(source, /function reusableSupervisor[\s\S]*!supervisorBindingHeld\(candidateKey, entry\)/)
  assert.match(ensure, /const preserveVisibleIntent = resolved\?\.chatgptVisible === true/)
  assert.match(ensure, /retireChatGPTSupervisorSurface\(reusable\[0\]\)[\s\S]*if \(preserveVisibleIntent && resolved\) resolved\.chatgptVisible = true/)
})

test('a busy Supervisor hides its old surface and publishes the deferred target state', async () => {
  const source = await readActivityRecoverySource()
  const viewState = await readFile(new URL('../../chatgpt/session/views/state.mjs', import.meta.url), 'utf8')
  const navigationIPC = await readFile(new URL('../../chatgpt/session/ipc/navigation.mjs', import.meta.url), 'utf8')
  const deferStart = source.indexOf('function setDeferredSupervisorNavigation(')
  const deferEnd = source.indexOf('\nasync function applyDeferredSupervisorNavigation', deferStart)
  const deferred = source.slice(deferStart, deferEnd)
  const navigateStart = navigationIPC.indexOf("ipcMain.handle('wharness:chatgpt:navigate'")
  const navigateEnd = navigationIPC.indexOf("ipcMain.handle('wharness:chatgpt:confirm-affinity'", navigateStart)
  const navigate = navigationIPC.slice(navigateStart, navigateEnd)

  assert.match(source, /createChatGPTViewState\(\{/)
  assert.match(viewState, /const surfaceDeferred = Boolean/)
  assert.match(source, /function differentSupervisorTransport[\s\S]*candidateKey !== key[\s\S]*transportPreparationCount/)
  assert.match(deferred, /const activeTransport = differentSupervisorTransport\(key\)/)
  assert.match(deferred, /if \(activeTransport\)[\s\S]*setDeferredSupervisorNavigation\(key, windowState, request, current\)[\s\S]*return true/)
  assert.match(deferred, /current\.view\.setVisible\(false\)/)
  assert.match(deferred, /sendToWindowState\(windowState, 'wharness:chatgpt:state', currentChatGPTState\(key, windowState\)\)/)
  assert.match(navigate, /return currentChatGPTState\(key, windowState\)/)
  assert.doesNotMatch(navigate, /return currentChatGPTState\(supervisorKey\(\), windowState\)/)
})

test('deferred Supervisor navigation retries until its gate is actually clear', async () => {
  const source = await readActivityRecoverySource()
  const scheduleStart = source.indexOf('function scheduleDeferredSupervisorNavigation()')
  const scheduleEnd = source.indexOf('\nfunction setDeferredSupervisorNavigation', scheduleStart)
  const schedule = source.slice(scheduleStart, scheduleEnd)
  const applyStart = source.indexOf('async function applyDeferredSupervisorNavigation()')
  const applyEnd = source.indexOf('\nfunction wait(ms)', applyStart)
  const apply = source.slice(applyStart, applyEnd)

  assert.match(schedule, /setTimeout\([\s\S]*applyDeferredSupervisorNavigation\(\)/)
  assert.match(apply, /differentSupervisorTransport\(pending\.key\)[\s\S]*scheduleDeferredSupervisorNavigation\(\)[\s\S]*return/)
  assert.match(apply, /!chatgptViews\.has\(pending\.key\) && chatgptViews\.size >= getDesiredChatAgentSupervisorSlots\(\)/)
  assert.match(apply, /!reusableSupervisor\(pending\.key, state\)[\s\S]*scheduleDeferredSupervisorNavigation\(\)[\s\S]*return/)
  assert.match(apply, /clearDeferredSupervisorNavigation\(\)[\s\S]*activateChatGPTView\(pending\.key/)
})

test('confirmed ChatGPT submits treat remote-state and supervision failures as post-submit failures instead of resending', async () => {
  const source = await readActivityRecoverySource()
  const helperStart = source.indexOf('async function persistWorkspaceChatRemoteBestEffort(')
  const helperEnd = source.indexOf('\nasync function enqueueChatAgentTask', helperStart)
  const helper = source.slice(helperStart, helperEnd)
  assert.match(helper, /try \{[\s\S]*persistWorkspaceChatRemote[\s\S]*catch \(error\)/)
  assert.match(helper, /return \{ ok: false, error: detail \}/)

  const writeStart = source.indexOf('async function executeChatAgentWrite(')
  const writeEnd = source.indexOf('\nasync function executeChatAgentAwaitResponse', writeStart)
  const write = source.slice(writeStart, writeEnd)
  assert.match(write, /submitPromptToChatGPT/)
  assert.match(write, /persistWorkspaceChatRemoteBestEffort/)
  assert.match(write, /try \{[\s\S]*enqueueChatAgentTask\('AWAIT_RESPONSE'/)
  assert.match(write, /status: 'attention'/)
  assert.doesNotMatch(write, /enqueueChatAgentTask\('RECOVERY_WRITE'/)
})

test('retry refuses to replay a request that already has an armed expected bundle', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function retryPreparedChatGPTPrompt(')
  const end = source.indexOf('\nasync function attachContextToChatGPT', start)
  const body = source.slice(start, end)
  assert.match(body, /const supervised = expectedChatGPTBundles\.get\(key\)/)
  assert.match(body, /supervised\?\.requestId === requestId/)
  assert.match(body, /alreadySupervised: true/)
})

test('pollChatGPTVisibleActivity skips DOM probing while the view is still navigating, mirroring pollExpectedChatGPTDownloadKey', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function pollChatGPTVisibleActivity()')
  const end = source.indexOf('\nasync function performChatGPTRecoveryAction', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = source.slice(start, end)
  const loadingGuard = body.indexOf('if (entry.loading) continue')
  const firstProbe = body.indexOf('executeJavaScript(chatGPTHumanActionScript()')
  assert.notEqual(loadingGuard, -1)
  assert.notEqual(firstProbe, -1)
  assert.ok(loadingGuard < firstProbe, 'the loading guard must run before any DOM probe')
})

test('activity polling is single-flight and reads visible reasoning only for an armed response', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function pollChatGPTVisibleActivity()')
  const end = source.indexOf('\nasync function performChatGPTRecoveryAction', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = source.slice(start, end)

  assert.match(body, /if \(readPollingChatGPTVisibleActivity\(\)\) return/)
  assert.match(body, /setPollingChatGPTVisibleActivity\(true\)/)
  assert.match(body, /finally \{\s*setPollingChatGPTVisibleActivity\(false\)\s*}/)
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  assert.match(main, /readPollingChatGPTVisibleActivity: \(\) => pollingChatGPTVisibleActivity/)
  assert.match(main, /setPollingChatGPTVisibleActivity: \(value\) => \{ pollingChatGPTVisibleActivity = value \}/)

  const expected = body.indexOf('const expectedActive = expectedChatGPTBundles.has(key)')
  const activityProbe = body.indexOf('executeJavaScript(chatGPTVisibleActivityScript()')
  assert.notEqual(expected, -1)
  assert.notEqual(activityProbe, -1)
  assert.ok(expected < activityProbe, 'the expected-response check must precede the expensive reasoning probe')
  assert.match(body, /if \(!expectedActive\) continue/)
})

test('every ChatGPT recovery/bundle/human-escalation choke point durably records a task event', async () => {
  const source = await readActivityRecoverySource()
  const bundle = await readFile(new URL('../../chatgpt/downloads/bundle.mjs', import.meta.url), 'utf8')
  const downloadRuntime = await readFile(new URL('../downloads/runtime.mjs', import.meta.url), 'utf8')
  const attention = await readFile(new URL('../../chatgpt/session/attention/notice.mjs', import.meta.url), 'utf8')

  const performStart = source.indexOf('async function performChatGPTRecoveryAction(key, expected, entry, action, completion = {})')
  const performEnd = source.indexOf('\nfunction escalateChatGPTContinuationFailure', performStart)
  assert.notEqual(performStart, -1)
  const perform = source.slice(performStart, performEnd)
  assert.match(perform, /recordChatGPTTaskEvent\(expected, 'chatgpt\.recovery_reload'/)
  assert.match(perform, /recordChatGPTTaskEvent\(expected, 'chatgpt\.recovery_keep_continue'/)

  const humanActionStart = attention.indexOf('function setChatGPTHumanAction(cacheKey, kind, detail = \'\', source = \'dom\')')
  const humanActionEnd = attention.indexOf('\n  function clearChatGPTHumanAction', humanActionStart)
  assert.notEqual(humanActionStart, -1)
  assert.match(source, /createChatGPTHumanAttention\(\{/)
  assert.match(attention.slice(humanActionStart, humanActionEnd), /recordChatGPTTaskEvent\(expected, 'chatgpt\.human_action_required'/)

  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  assert.match(main, /recordChatGPTTaskEvent: \(\.\.\.args\) => recordChatGPTTaskEvent\(\.\.\.args\)/)
  assert.match(downloadRuntime, /recordTaskEvent: d\.recordChatGPTTaskEvent/)
  assert.match(bundle, /recordTaskEvent\(live, 'chatgpt\.bundle_validated'/)
  assert.match(bundle, /recordTaskEvent\(live, 'chatgpt\.bundle_rejected'/)

  assert.match(source, /function recordChatGPTContinuationSent\(expected, trigger, reason\)/)
  const manualRecovery = await readFile(new URL('../../chatgpt/transport/downloads/recovery/continue.mjs', import.meta.url), 'utf8')
  assert.match(manualRecovery, /recordChatGPTContinuationSent\(expected, 'manual',/)
  assert.match(source, /recordChatGPTContinuationSent\(expected, 'automatic',/)
})

test('the Main Request task id is captured from the guaranteed AWAIT_RESPONSE enqueue in both submission paths', async () => {
  const source = await readActivityRecoverySource()

  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const prepareEnd = source.indexOf('\nasync function retryPersistedChatGPTPrompt', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  assert.match(prepare, /armed\.mainRequestTaskId = String\(mainRequestTask\?\.task_id \|\| ''\)/)

  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft(')
  const preparedEnd = source.indexOf('\nasync function submitPromptToChatGPT', preparedStart)
  const prepared = source.slice(preparedStart, preparedEnd)
  assert.match(prepared, /armed\.mainRequestTaskId = String\(mainRequestTask\?\.task_id \|\| ''\)/)

  assert.match(source, /return enqueueChatAgentTask\('AWAIT_RESPONSE', \{ \.\.\.common, dedupeKey: `await:\$\{requestId\}`, maxAttempts: 30, retry: true \}\)/)
})

test('an in-flight download click suppresses the completed-without-bundle keep-continue race in Supervisor polling', async () => {
  const source = await readActivityRecoverySource()
  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', pollStart)
  assert.notEqual(pollStart, -1)
  const poll = source.slice(pollStart, pollEnd)
  const clickBlockEnd = poll.indexOf('expected.rehydrating) return')
  const downloadInFlightGuard = poll.indexOf('if (expected.downloadInFlight) {')
  const recoveryDecision = poll.indexOf('chooseChatGPTRecoveryAction(expected.recovery, {\n        complete: completionSettled')
  assert.notEqual(downloadInFlightGuard, -1, 'a bounded downloadInFlight wait must exist before the completion/recovery probe')
  assert.notEqual(recoveryDecision, -1)
  assert.ok(downloadInFlightGuard < clickBlockEnd, 'the downloadInFlight wait must run before the rehydration/completion probe')
  assert.ok(downloadInFlightGuard < recoveryDecision, 'the downloadInFlight wait must run before completed-without-bundle can be decided')
  assert.match(poll, /const pendingMs = now - Number\(expected\.lastDOMClick \|\| now\)\s*\n\s*if \(pendingMs < DOWNLOAD_INFLIGHT_TIMEOUT_MS\) return/)
})
