import { readActivityRecoverySource } from './activity-recovery-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('bundle supervision cannot reload or probe a ChatGPT surface during transport preparation', async () => {
  const source = await readActivityRecoverySource()
  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', pollStart)
  const poll = source.slice(pollStart, pollEnd)
  const transportGuard = poll.indexOf('entry?.transportPreparationCount')
  const recoveryProbe = poll.indexOf('chooseChatGPTRecoveryAction')
  const domProbe = poll.indexOf('executeJavaScript(chatGPTExpectedDownloadScript')
  assert.notEqual(transportGuard, -1)
  assert.ok(transportGuard < recoveryProbe)
  assert.ok(transportGuard < domProbe)
})

test('the durable response inbox is isolated by Desktop userData instead of shared through host temp', async () => {
  const source = await readActivityRecoverySource()
  const directoryStart = source.indexOf('function pendingBundleDirectory()')
  const directoryEnd = source.indexOf('\nasync function pendingChatGPTBundlePayloads', directoryStart)
  assert.notEqual(directoryStart, -1)
  const directory = source.slice(directoryStart, directoryEnd)
  assert.match(directory, /app\.getPath\('userData'\)/)
  assert.match(directory, /pending-chatgpt-bundles-v1/)
  assert.doesNotMatch(directory, /app\.getPath\('temp'\)/)
})

// The DOM poller kept clicking the same download affordance after the bundle
// had already been delivered: each click genuinely re-downloaded the ZIP, the
// will-download handler dropped it as a duplicate, downloadInFlight cleared on
// `done`, and the next sweep clicked again — a hot loop that never progressed.
test('expected-bundle polling stops once the request has been delivered', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function pollExpectedChatGPTDownloadKey')
  const clickIndex = source.indexOf('chatGPTExpectedDownloadScript(expected.filename', start)
  assert.notEqual(start, -1)
  assert.notEqual(clickIndex, -1)
  const guard = source.indexOf('recentlyDeliveredChatGPTBundleRequestId(expected.requestId)', start)
  assert.notEqual(guard, -1, 'poller must check whether the bundle already arrived')
  assert.ok(guard < clickIndex, 'the delivered check must run before the download click')
  // Supervision is finished, so the expectation is released rather than merely
  // skipped — otherwise the surface stays supervised forever.
  assert.match(source.slice(guard, clickIndex), /disarmExpectedChatGPTBundle\(key, expected\.requestId\)/)
})

test('await-response is a passive resident probe with fixed healthy cadence', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function probeChatAgentResponse(')
  const end = source.indexOf('\nasync function executeChatAgentWrite', start)
  assert.notEqual(start, -1)
  const body = source.slice(start, end)

  assert.match(body, /CHAT_AGENT_AWAIT_PROBE_MS/)
  assert.match(body, /waitForChatGPTSurfaceReady\(key, entry\)/)
  assert.match(body, /chatGPTHumanActionScript/)
  assert.match(body, /chatGPTResponseCompletionScript/)
  assert.doesNotMatch(body, /targetChatGPTComposer/)
  assert.doesNotMatch(body, /\.reload\(/)
  assert.doesNotMatch(body, /chatAgentBackoff/)
})

test('idle Supervisor state never validates an absent task as a cache key', async () => {
  const runtime = await readFile(new URL('../../agent/supervision/runtime-snapshot.mjs', import.meta.url), 'utf8')

  assert.match(runtime, /sanitizeOptionalChatCacheKey\(runtime\.task\?\.chat_id\)/)
  assert.doesNotMatch(runtime, /sanitizeChatCacheKey\(runtime\.task\?\.chat_id/)
})

test('AWAIT_RESPONSE confirms a completion before concluding the bundle is missing', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function probeChatAgentResponse(')
  const probe = source.slice(start, source.indexOf('\nasync function executeChatAgentWrite', start))

  // One instant of a live page is not evidence of completion: ChatGPT satisfies
  // every structural completion condition transiently between reasoning steps
  // and before the file card mounts. Acting on a single sample is what produced
  // "terminou sem disponibilizar" over a response still being generated.
  assert.match(probe, /PROCESSING_SIGNAL_GRACE_MS/)
  assert.match(probe, /BUNDLE_COMPLETION_CONFIRM_MS/)
  assert.match(probe, /processingAbsentSince/)
  // A still-generating page is a passive observation, never a spent attempt.
  assert.match(probe, /thinking === true[\s\S]*?observation: true/)
  // Continuations are real ChatGPT requests and must be spaced by the shared helper.
  assert.match(probe, /enqueueChatAgentContinuation/)
  const continuationStart = source.indexOf('async function enqueueChatAgentContinuation(')
  const continuationEnd = source.indexOf('\nasync function probeChatAgentResponse(', continuationStart)
  const continuation = source.slice(continuationStart, continuationEnd)
  assert.match(continuation, /BUNDLE_CONTINUATION_BASE_MS/)
  assert.match(continuation, /lastContinuationAt/)
  assert.match(continuation, /operation: 'CONTINUE_REQUEST'/)
  assert.match(continuation, /MAX_AUTOMATIC_BUNDLE_CONTINUATIONS/)
})

test('automatic bundle recovery is one wake-up and validation quiesces queued or in-flight recovery', async () => {
  const source = await readActivityRecoverySource()
  const timing = await readFile(new URL('../../chatgpt/config/runtime-timing.mjs', import.meta.url), 'utf8')
  assert.match(source, /MAX_AUTOMATIC_BUNDLE_CONTINUATIONS/)
  assert.match(timing, /export const MAX_AUTOMATIC_BUNDLE_CONTINUATIONS = 1/)

  const quiesce = await readFile(new URL('../../chatgpt/transport/downloads/expectation/validated.mjs', import.meta.url), 'utf8')
  assert.match(source, /createValidatedBundleState\(\{/)
  assert.match(source, /scheduler: \(\) => chatAgentScheduler/)
  assert.match(quiesce, /abortChatGPTTransportPreparations/)
  assert.match(quiesce, /activeScheduler\.cancelLineage/)

  const bundleSource = await readFile(new URL('../../chatgpt/downloads/bundle.mjs', import.meta.url), 'utf8')
  assert.match(source, /quiesceRecovery: quiesceChatGPTRecoveryAfterValidatedBundle/)
  assert.match(source, /publishBundle: publishBundleDownload/)
  const handlerValidation = bundleSource.indexOf('quiesceRecovery(validated.requestId')
  const publish = bundleSource.indexOf('publishBundle(', handlerValidation)
  assert.ok(handlerValidation >= 0 && publish > handlerValidation, 'valid bundle must quiesce recovery before publication/ack')

  const helperStart = source.indexOf('async function submitChatGPTContinuation(')
  const helperEnd = source.indexOf('\n\nfunction durableWorkspaceChatID(', helperStart)
  const helper = source.slice(helperStart, helperEnd)
  assert.match(helper, /beforeDispatch: preDispatch/)
  assert.match(helper, /automaticChatGPTContinuationBlockReason/)
  assert.match(helper, /throwIfChatGPTTransportAborted/)

  const recoveryStart = source.indexOf('async function performChatGPTRecoveryAction(')
  const recoveryEnd = source.indexOf('\nfunction escalateChatGPTContinuationFailure', recoveryStart)
  const recovery = source.slice(recoveryStart, recoveryEnd)
  assert.doesNotMatch(recovery, /expected\.recovery = createChatGPTRecoveryState/)
  assert.match(recovery, /MAX_AUTOMATIC_BUNDLE_CONTINUATIONS/)

  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads()', pollStart)
  const poll = source.slice(pollStart, pollEnd)
  const afterRecovery = poll.slice(poll.indexOf('if (recoveryAction)'))
  assert.doesNotMatch(afterRecovery, /submitChatGPTContinuation/)
})

test('Worker recovery writes send only keep continue and never rebuild the request bundle', async () => {
  const source = await readActivityRecoverySource()
  const helperStart = source.indexOf('async function submitChatGPTContinuation(')
  const helperEnd = source.indexOf('\n\nfunction durableWorkspaceChatID(', helperStart)
  const helper = source.slice(helperStart, helperEnd)
  assert.match(helper, /const prompt = chatGPTDeliveryContinuationPrompt\(\)/)
  assert.match(helper, /chatGPTFillComposerScript\(prompt\)/)
  assert.doesNotMatch(helper, /fillBundledChatGPTComposer|submitPromptToChatGPT/)

  const writeStart = source.indexOf('async function executeChatAgentWrite(')
  const writeEnd = source.indexOf('\nasync function enqueueChatAgentFollowups', writeStart)
  const write = source.slice(writeStart, writeEnd)
  assert.match(write, /payload\.operation === 'CONTINUE_REQUEST'/)
  assert.match(write, /submitChatGPTContinuation\(key, conversationURL, task\.request_id, entry\)/)
  assert.match(write, /chatGPTBundleAlreadyValidated\(task\.request_id\)/)
  assert.match(write, /result\?\.skipped/)
})

test('no AWAIT_RESPONSE outcome that never reached ChatGPT spends the attempt budget', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function probeChatAgentResponse(')
  const probe = source.slice(start, source.indexOf('\nasync function executeChatAgentWrite', start))

  // Every one of these charged an attempt without reaching the provider, so a
  // 30-second cadence against max_attempts=30 retired supervision after roughly
  // fifteen minutes — the signature of all 23 "exhausted maximum attempts while
  // waiting" failures observed on this instance.
  assert.match(probe, /resident worker is no longer on the expected conversation[\s\S]{0,80}/)
  assert.match(probe, /observation: true, error: 'resident worker is no longer on the expected conversation'/)
  assert.match(probe, /complete !== true[\s\S]*?observation: true/)

  // Because those outcomes are free, the ambiguous state needs its own bound,
  // and it has to be evidence-shaped rather than a retry counter.
  assert.match(probe, /AWAIT_STALL_ATTENTION_MS/)
  assert.match(probe, /expected\.progressAt/)
  const timing = await readFile(new URL('../../chatgpt/config/runtime-timing.mjs', import.meta.url), 'utf8')
  assert.match(timing, /export const AWAIT_STALL_ATTENTION_MS = 3 \* 60_000/)

  // An active provider cooldown is likewise not an attempt.
  const execute = source.slice(source.indexOf('async function executeChatAgentTask('))
  assert.match(execute.slice(0, 900), /initialRateLimitDelay, observation: true/)
})

test('a conversation still producing a response is never concluded without evidence it ran', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function probeChatAgentResponse(')
  const probe = source.slice(start, source.indexOf('\nasync function executeChatAgentWrite', start))

  // The ordinary grace means "generation visibly stopped and stayed stopped",
  // which is only meaningful once that indicator was actually seen. Without it
  // the window degraded to "the page has looked static since we first looked" —
  // true of a turn that has not started and of a gap between reasoning phases.
  assert.match(probe, /expected\.processingObservedAt \? PROCESSING_SIGNAL_GRACE_MS : BUNDLE_UNOBSERVED_SETTLE_MS/)
  assert.match(probe, /now - idleSince < settleWindow/)
  const timing = await readFile(new URL('../../chatgpt/config/runtime-timing.mjs', import.meta.url), 'utf8')
  assert.match(source, /BUNDLE_UNOBSERVED_SETTLE_MS/)
  assert.match(timing, /export const BUNDLE_UNOBSERVED_SETTLE_MS = 3 \* 60_000/)
})

test('supervision scheduled after a write waits for the turn to start', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function executeChatAgentWrite(')
  const write = source.slice(start, source.indexOf('\nasync function enqueueOrganizeFromTitle', start))

  // Measured: a recovery write at 12:42:56 reached ATTENTION at 12:43:17 because
  // its supervision was claimable in the same second and read the turn before it.
  assert.match(write, /notBefore: new Date\(Date\.now\(\) \+ chatAgentInitialRequestWaitMs\(\)\)\.toISOString\(\)/)
})
