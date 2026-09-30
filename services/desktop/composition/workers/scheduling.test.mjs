import { readActivityRecoverySource } from '../supervision/activity-recovery-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Auto scale reconciles against the persisted policy ceiling', async () => {
  const source = await readFile(new URL('../../agent/scheduling/capacity/auto-scale-runtime.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function reconcileChatAgentAutoScale()')
  const end = source.indexOf('\n  function reconcileChatTranslatorCapacity', start)
  const reconcile = source.slice(start, end)
  assert.notEqual(start, -1)
  assert.match(reconcile, /maxWorkers: state\.chatAgentPolicies\.auto_scale_max_workers/)
  assert.doesNotMatch(reconcile, /maxWorkers: HARD_MAX_WORKER_SLOTS/)
})

test('worker scheduling keeps residency and slot mutation explicit', async () => {
  const source = await readActivityRecoverySource()
  const transport = await readFile(new URL('../../chatgpt/transport/requests/transport-preparation.mjs', import.meta.url), 'utf8')
  const runtimeState = await readFile(new URL('../state/runtime.mjs', import.meta.url), 'utf8')
  assert.match(source, /createDesktopRuntimeState\(\{/)
  assert.match(runtimeState, /new ChatAgentResidency\(/)
  assert.match(source, /claimOptions: \(worker\) =>/)
  assert.match(source, /chatAgentResidency\.claimOptions\(entry\.slotId/)
  assert.match(transport, /const transportKey = entry\.role === 'worker' \? `slot:\$\{entry\.slotId\}` : `chat:\$\{key\}`/)
  assert.match(source, /tails: chatGPTTransportTails/)
  assert.match(source, /residency: chatAgentResidency/)
  assert.match(source, /await waitForChatGPTSurfaceReady\(key, entry\)[\s\S]*chatAgentResidency\.settleAssignment/)
})

test('request pacing samples only structurally extracted durations for valid bundles', async () => {
  const source = await readActivityRecoverySource()
  assert.match(source, /chatGPTProcessingDurationScript\(CHATGPT_BEHAVIOR\.labels\.reasoningDisclosure, expected\.assistantBaseline\)/)
  assert.match(source, /request_eligible_at/)
  assert.match(source, /recordRateLimit\(source, classification\.kind, Math\.round\(configuredCooldownMs \/ 1000\)\)/)

  const validateIndex = source.indexOf('validateWharnessBundleDownload')
  const recordIndex = source.indexOf('recordValidBundle', validateIndex)
  assert.notEqual(validateIndex, -1)
  assert.notEqual(recordIndex, -1)
  assert.ok(recordIndex > validateIndex, 'processing samples must be recorded only after bundle validation')
})

test('a hidden Worker gets a layout viewport even while it owns the Supervisor selected chat', async () => {
  const source = await readFile(new URL('../../chatgpt/account/control/viewport.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function ensureChatGPTLayoutViewport(')
  const viewport = source.slice(start, source.indexOf('\n  }', source.indexOf('return true', start)))

  // Identifying the visible surface by chat key alone left a hidden Worker at
  // 0x0 whenever it owned the selected chat, so every located account control
  // measured as offscreen and the task burned its whole attempt budget.
  assert.match(viewport, /ownerState\?\.activeChatGPTKey === key && chatgptViews\.get\(key\) === entry/)
  assert.doesNotMatch(viewport, /if \(ownerState\?\.activeChatGPTKey === key\) return false/)
})

test('autonomous submissions are spaced process-wide and re-check the provider cooldown', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function executeChatAgentWrite(')
  const write = source.slice(start, source.indexOf('\nasync function enqueueChatAgentFollowups', start))

  // Transport is serialized per Worker slot, which bounds one slot but not the
  // pool: every free slot could otherwise submit at once against one account.
  assert.match(write, /await paceChatGPTWorkerSubmission\(\)/)
  assert.match(write, /chatAgentRateLimitDelayMs\(\)/)

  // The spacing is now derived rather than fixed, so a resumed pool does not
  // rebuild the burst; the healthy floor is still CHAT_AGENT_SUBMIT_GAP_MS.
  // Passed as a function, not a value: the gap is measured after the queue
  // wait so a 429 raised while this caller was queued widens its own spacing.
  const pacer = source.slice(source.indexOf('async function paceChatGPTWorkerSubmission('))
  assert.match(pacer.slice(0, 900), /translation \? \(\) => CHAT_AGENT_TRANSLATION_ACTION_GAP_MS : chatAgentSubmissionGapMs/)
  const gapStart = source.indexOf('function chatAgentSubmissionGapMs(')
  const gap = source.slice(gapStart, source.indexOf('\nasync function paceChatGPTWorkerSubmission(', gapStart))
  assert.match(gap, /CHAT_AGENT_SUBMIT_GAP_MS/)
})

test('a worker that takes a task yields its place in the rotation', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function executeChatAgentTask(')
  const execute = source.slice(start, source.indexOf('\n  switch (task.type)', start))
  assert.match(execute, /chatAgentResidency\.noteAssignment\(entry\.slotId\)/)
})

test('the cross-chat navigation gate follows the provider instead of one fixed clock', async () => {
  const source = await readActivityRecoverySource()
  const gap = source.slice(source.indexOf('function chatAgentNavigationGapMs('))

  // Navigation is serialized process-wide, so a fixed 30-second ceiling let the
  // whole pool rebind twice a minute however many workers were free.
  assert.match(gap.slice(0, 900), /rate_limit_level/)
  assert.match(gap.slice(0, 900), /CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS/)
  assert.match(gap.slice(0, 900), /CHATGPT_WORKER_NAVIGATION_GAP_MS/)
  const settings = await readFile(new URL('../config/runtime.mjs', import.meta.url), 'utf8')
  assert.match(source, /CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS/)
  assert.match(settings, /navigationGapHealthyMs: CHAT_AGENT_WORKER_ACTION_GAP_MS/)

  const pacer = source.slice(source.indexOf('async function paceChatGPTWorkerNavigation('))
  assert.match(pacer.slice(0, 600), /paceChatGPTWorkerRequest\(chatAgentNavigationGapMs\)/)
  assert.doesNotMatch(pacer.slice(0, 600), /CHATGPT_WORKER_NAVIGATION_GAP_MS -/)
})

test('an empty claim releases a resident lane that has run dry', async () => {
  const source = await readActivityRecoverySource()
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))

  // Without this the pool degraded to one effective worker: a resident slot can
  // only claim its own lane, so it could never be rebound by claiming elsewhere.
  assert.match(scheduler.slice(0, 7000), /onIdle: \(worker\) => \{/)
  assert.match(scheduler.slice(0, 7000), /chatAgentResidency\.noteIdleClaim\(entry\.slotId\)/)
})

test('live response residency is pinned so excess chats cannot cause navigation thrash', async () => {
  const source = await readActivityRecoverySource()
  const schedulerStart = source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient(')
  const scheduler = source.slice(schedulerStart, source.indexOf('chatSupervisorScheduler = new ChatAgentSchedulerClient(', schedulerStart))
  assert.match(scheduler, /pinResident: chatAgentSupervisingLiveResponse\(worker\)/)
  assert.match(source, /const MAX_BUNDLE_CONTINUATIONS = 3/)
  assert.match(source, /const prompt = chatGPTDeliveryContinuationPrompt\(\)/)
  assert.match(source, /submitChatGPTContinuation\(key, conversationURL, task\.request_id, entry\)/)
})

test('only ChatGPT\'s own limit control in the DOM suspends Workers; an HTTP 429 alone never does', async () => {
  const source = await readActivityRecoverySource()
  const handler = await readFile(new URL('../../chatgpt/session/health/http-status.mjs', import.meta.url), 'utf8')
  // 48 refusals of the sidebar conversation list suspended every Worker 19
  // times in one evening while the account submitted normally.
  assert.doesNotMatch(handler, /applyChatGPTRateLimit\(/)
  const callers = [...source.matchAll(/applyChatGPTRateLimit\(([^)]*)\)/g)].map((match) => match[1])
  assert.deepEqual(callers.filter((args) => !args.startsWith('cacheKey, {')), [])
  assert.match(source, /applyChatGPTRateLimit\(cacheKey, \{ source: 'dom_gate', domGate: true \}\)/)
})

test('an account-wide rate-limit gate suspends Workers for the configured window', async () => {
  const source = await readActivityRecoverySource()
  assert.match(source, /const CHATGPT_RATE_LIMIT_BACKOFF_MS = 7\.5 \* 60_000/)
  assert.match(source, /Os Workers ficam suspensos por \$\{cooldownLabel\}; Supervisores e Translator continuam operacionais/)

  const start = source.indexOf('function applyChatGPTRateLimit(')
  const apply = source.slice(start, source.indexOf('\nfunction noteChatGPTRateLimitGate(', start))
  assert.match(apply, /classifyChatGPTRateLimit\(state\.hits, \{ now, domGate \}\)/)
  assert.match(apply, /state\.policies\.rate_limit_cooldown_minutes/)
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  assert.match(main, /get hits\(\) \{ return desktopState\.chatgpt\.chatGPTRateLimitHits \}, set hits\(value\) \{ desktopState\.chatgpt\.chatGPTRateLimitHits = value \}/)
  assert.match(main, /get policies\(\) \{ return desktopState\.agent\.chatAgentPolicies \}/)
  assert.match(apply, /Math\.min\(60 \* 60_000, Math\.max\(60_000, requestedCooldownMs\)\)/)
  // The kind has to reach the durable store, or the backend keeps applying the
  // shorter pause to an account-wide block.
  assert.match(apply, /recordRateLimit\(source, classification\.kind, Math\.round\(configuredCooldownMs \/ 1000\)\)/)
})

test('Worker upload and submit recheck suspension at the last provider-facing boundary', async () => {
  const source = await readActivityRecoverySource()
  const pasteStart = source.indexOf('async function pasteChatGPTFile(')
  const paste = source.slice(pasteStart, source.indexOf('\n// Submission has two different facts', pasteStart))
  assert.match(paste, /if \(pacedWorker\) await paceChatGPTWorkerSubmission\(\{ translation \}\)[\s\S]*if \(pacedWorker && !translation\)[\s\S]*chatAgentRateLimitDelayMs\(\)[\s\S]*throw new ChatGPTRateLimitDeferral/)

  const submitStart = source.indexOf('async function submitChatGPTDraft(')
  const submit = source.slice(submitStart, source.indexOf('\nasync function preparePromptForChatGPT(', submitStart))
  assert.match(submit, /beforeSubmit:[\s\S]*if \(!rateLimitExempt\)[\s\S]*chatAgentRateLimitDelayMs\(\)[\s\S]*throw new ChatGPTRateLimitDeferral/)
})

test('automatic rate-limit resume reloads one Worker and confirms the structural gate before claims resume', async () => {
  const source = await readActivityRecoverySource()
  const resume = await readFile(new URL('../../chatgpt/session/health/rate-limit-resume.mjs', import.meta.url), 'utf8')
  const pacing = await readFile(new URL('../transport/pacing/runtime.mjs', import.meta.url), 'utf8')
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const stage = await readFile(new URL('../transport/stage/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /createDesktopChatGPTTransportStage\(chatGPTTransportStageDependencies\)/)
  assert.match(stage, /createDesktopChatGPTPacing\(\{/)
  assert.match(pacing, /createChatGPTRateLimitResume\(\{/)
  assert.match(resume, /state\.resumeProbeRequired/)
  assert.match(resume, /wc\.reload\(\)/)
  assert.match(resume, /await wait\(50\)/)
  assert.match(resume, /waitForChatGPTReady/)
  assert.match(resume, /wc\.executeJavaScript\(chatGPTHumanActionScript\(\), true\)/)
  assert.match(resume, /health\.rateLimited !== false/)
  assert.match(resume, /noteChatGPTRateLimitGate\(key, health\)/)
  assert.match(resume, /state\.resumeProbeRequired = false/)

  const workerClaim = source.slice(source.indexOf('claimOptions: (worker)'), source.indexOf('onIdle:', source.indexOf('claimOptions: (worker)')))
  const supervisorClaim = source.slice(source.indexOf('claimOptions: (index)'), source.indexOf('onIdle:', source.indexOf('claimOptions: (index)')))
  assert.match(workerClaim, /chatAgentRateLimitResumeBlocked\(\)/)
  assert.doesNotMatch(supervisorClaim, /chatAgentRateLimitResumeBlocked\(\)/)
})

test('Worker cooldown does not block Supervisor continuation paths', async () => {
  const source = await readActivityRecoverySource()
  const deferral = source.slice(source.indexOf('class ChatGPTRateLimitDeferral'), source.indexOf('\nasync function paceChatGPTWorkerRequest'))
  assert.match(deferral, /this\.retryUpload = false/)

  const polling = source.slice(source.indexOf('async function pollExpectedChatGPTDownloadKey('), source.indexOf('\nasync function pollExpectedChatGPTDownloads('))
  assert.doesNotMatch(polling, /chatAgentRateLimitResumeBlocked\(\)/)

  const recovery = source.slice(source.indexOf('async function performChatGPTRecoveryAction('), source.indexOf('\nfunction escalateChatGPTContinuationFailure'))
  assert.match(recovery, /error instanceof ChatGPTRateLimitDeferral\) return true/)

  const manual = await readFile(new URL('../../chatgpt/transport/downloads/recovery/continue.mjs', import.meta.url), 'utf8')
  assert.match(manual, /error instanceof ChatGPTRateLimitDeferral[\s\S]*reason: 'provider_cooldown'/)
})

test('workers stop claiming while the provider cooldown is active', async () => {
  const source = await readActivityRecoverySource()
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))
  const claimOptions = scheduler.slice(scheduler.indexOf('claimOptions: (worker)'), scheduler.indexOf('onIdle:'))
  // Claiming during a cooldown charges an attempt to every task it touches and
  // hands each one straight back to WAITING.
  assert.match(claimOptions, /if \(chatAgentRateLimitResumeBlocked\(\)\) return \{ skip: true \}/)
})
