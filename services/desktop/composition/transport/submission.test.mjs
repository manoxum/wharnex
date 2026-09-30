import { readActivityRecoverySource } from '../supervision/activity-recovery-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('request preparation registers a cooperative abort before waiting for its transport slot', async () => {
  const source = await readFile(new URL('../../chatgpt/transport/requests/transport-preparation.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function withChatGPTTransportPreparation(')
  const end = source.indexOf('\n  return { abortChatGPTTransportPreparations', start)
  const helper = source.slice(start, end)
  assert.match(helper, /const controller = new AbortController\(\)/)
  assert.match(helper, /registerAbort\(key, requestId, controller\)/)
  assert.ok(helper.indexOf('registerAbort') < helper.indexOf('await prior'))
  assert.match(helper, /entry\.transportAbortSignal = controller\.signal/)
  assert.match(helper, /unregisterAbort\(abortKey, controller\)/)
})

test('in-flight comments defer stale bundle capture and rearm after the comment submit', async () => {
  const source = await readActivityRecoverySource()
  const commentStart = source.indexOf('async function flushQueuedChatGPTComments()')
  const commentEnd = source.indexOf('\nasync function pollChatGPTVisibleActivity', commentStart)
  const comments = source.slice(commentStart, commentEnd)
  assert.match(comments, /const assistantBaseline = await chatGPTAssistantTurnCount\(target\.wc\)/)
  assert.match(comments, /await submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target\)/)
  assert.match(comments, /armExpectedChatGPTBundle\(key, pending\.requestId, assistantBaseline, '', \[\], '', pending\.sessionId, expectedFilename, requestMetadata\)/)

  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nconst browserSessionOperations', pollStart)
  const polling = source.slice(pollStart, pollEnd)
  assert.match(polling, /hasPendingChatGPTComments\(key\)\) return/)
  assert.match(polling, /chatGPTResponseCompletionScript\(expected\.assistantBaseline\)/)
  assert.match(polling, /performChatGPTRecoveryAction/)
  assert.match(polling, /MAX_AUTOMATIC_BUNDLE_CONTINUATIONS/)
  assert.doesNotMatch(polling.slice(polling.indexOf('if (recoveryAction)')), /submitChatGPTContinuation/)
})

test('processing detection uses hysteresis and escalates a stale ambiguous control without interrupting it', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const end = source.indexOf('\nasync function pollExpectedChatGPTDownloads()', start)
  const polling = source.slice(start, end)
  assert.match(source, /PROCESSING_SIGNAL_GRACE_MS/)
  assert.match(source, /PROCESSING_STALE_ATTENTION_MS/)
  assert.match(polling, /expected\.processingAbsentSince/)
  assert.match(polling, /if \(expected\.rehydrating\) return/)
  assert.match(polling, /expected\.recoveryEligibleAt/)
  assert.match(polling, /processingSignalActive/)
  assert.match(polling, /ambiguous-processing-control/)
})

test('task comments use a single-flight queue with recent idempotency protection', async () => {
  const source = await readActivityRecoverySource()
  const collections = await readFile(new URL('../state/chatgpt.mjs', import.meta.url), 'utf8')
  assert.match(collections, /flushingChatGPTComments: new Set\(\)/)
  assert.match(source, /if \(flushingChatGPTComments\.has\(key\)\) continue/)
  assert.match(source, /recentChatGPTCommentIds\.set\(`\$\{key\}:\$\{pending\.commentId\}`/)
  assert.match(source, /recentChatGPTCommentFingerprints\.set\(pending\.fingerprint/)
  assert.match(source, /item\.commentId === commentId \|\| item\.fingerprint === fingerprint/)
  assert.match(source, /duplicate: true/)
})

test('bundle download failures remain correlated to a strict late filename instead of the newer active request', async () => {
  const source = await readActivityRecoverySource()
  const publish = await readFile(new URL('../../chatgpt/downloads/registration/publication.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatGPTDownloadPublication\(\{/)
  assert.match(publish, /wharnessBundleRequestIdFromFilename\(filename\) \|\| expectedChatGPTBundles\.get\(cacheKey\)\?\.requestId/)
})

test('ChatGPT request archive upload uses the dedicated file input instead of clipboard paste', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function pasteChatGPTFile(entry, filePath, index, count, { translation = false, pacedWorker = false } = {})')
  const end = source.indexOf('\nasync function submitChatGPTDraft', start)
  const upload = source.slice(start, end)
  assert.match(upload, /selectChatGPTUploadFile\(wc, filePath\)/)
  assert.doesNotMatch(upload, /clipboard\.write/)
  assert.doesNotMatch(upload, /wc\.paste\(\)/)
})

// Live testing against the real ChatGPT account (two concurrent hidden
// Workers each classifying a TODO) reproduced "did not start the file
// upload before timeout" on effectively every attempt: the provider did
// confirm most uploads eventually, just not inside the 8s observation
// window while a second Worker's own retry landed on ChatGPT around the
// same moment. Every attempt after the first is exactly the case the
// process-wide provider pacing gate exists for, so a retry that skips it
// reintroduces that contention.
test('every ChatGPT upload attempt, not only the first, is paced against the shared provider gate', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function pasteChatGPTFile(entry, filePath, index, count, { translation = false, pacedWorker = false } = {})')
  const end = source.indexOf('\nasync function submitChatGPTDraft', start)
  const upload = source.slice(start, end)
  const beforeAttemptStart = upload.indexOf('beforeAttempt: async () => {')
  const beforeAttemptEnd = upload.indexOf('beginUpload:', beforeAttemptStart)
  const beforeAttempt = upload.slice(beforeAttemptStart, beforeAttemptEnd)
  assert.match(beforeAttempt, /if \(pacedWorker\) await paceChatGPTWorkerSubmission\(\{ translation \}\)/)
})

test('task comments are sent as one logical protocol ZIP with optional multipart transport', async () => {
  const source = await readActivityRecoverySource()
  const materializeStart = source.indexOf('async function materializeProtocolChatInput')
  const materializeEnd = source.indexOf('\nasync function fillBundledChatGPTComposer', materializeStart)
  const materialize = source.slice(materializeStart, materializeEnd)
  assert.notEqual(materializeStart, -1)
  assert.match(materialize, /const \[context, knowledge, gitContext, continuation\] = await Promise\.all/)
  assert.match(materialize, /writeChatInputTransportArchives\(dir, \{/)
  // The attempt ledger and divergence report must ride in the same single
  // protocol ZIP; fetching them separately at send time would let a comment
  // reach ChatGPT without the evidence the prompt says is attached.
  assert.match(materialize, /fetchRequestGitContext\(sessionId, signal\)/)
  assert.match(materialize, /fetchRequestContinuation\(sessionId, requestId, signal\)/)
  // Comment/continuation protocol ZIPs are real outbound transport artifacts,
  // so persist the archive before the transient local copy is removed. This
  // keeps them visible in the same sent-bundle surfaces as the initial request.
  assert.match(materialize, /for \(const part of transport\.parts\) await persistChatArtifact/)

  const fillStart = source.indexOf('async function fillBundledChatGPTComposer')
  const fillEnd = source.indexOf('\nasync function executeChatGPTDOMScript', fillStart)
  const fill = source.slice(fillStart, fillEnd)
  assert.match(fill, /const signal = entry\?\.transportAbortSignal/)
  assert.match(fill, /materializeProtocolChatInput\([^\n]+requestMetadata, bounded\)/)
  assert.match(fill, /throwIfChatGPTTransportAborted\(signal\)/)
  assert.match(fill, /for \(let index = 0; index < input\.uploadPaths\.length; index \+= 1\) await pasteChatGPTFile/)

  const flushStart = source.indexOf('async function flushQueuedChatGPTComments')
  const flushEnd = source.indexOf('\nasync function pollChatGPTVisibleActivity', flushStart)
  const flush = source.slice(flushStart, flushEnd)
  assert.notEqual(flushStart, -1)
  assert.match(flush, /fillBundledChatGPTComposer\(key, target\.entry, pending\.sessionId, pending\.requestId, commentPrompt,[^\n]+pending\.attachments, requestMetadata\)/)
  assert.doesNotMatch(flush, /chatGPTFillComposerScript\(pending\.text\)/)
})

test('submitChatGPTDraft never replays an ambiguous automatic submit', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function submitChatGPTDraft(')
  const end = source.indexOf('\nasync function preparePromptForChatGPT', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = source.slice(start, end)
  assert.match(body, /submitWithoutReplay\(\{/)
  assert.match(body, /beginObservation: \(\) => chatGPTSubmissions\.expect\(wc\.id\)/)
  assert.doesNotMatch(body, /submitWithRetry\(/)
  assert.doesNotMatch(body, /beforeAttempt:/)
  assert.match(body, /const expectedConversation = canonicalChatGPTConversationURL\(expectedURL\)/)
  assert.match(body, /assertExpectedConversation\(\)/)
  assert.match(body, /sameConversationURL\(wc\.getURL\(\), expectedConversation\)/)
  assert.match(body, /continuing supervision without replay/)
})

test('every ChatGPT submit verifies the requested reasoning effort before starting its POST observation', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function submitChatGPTDraft(')
  const end = source.indexOf('\nasync function preparePromptForChatGPT', start)
  const body = source.slice(start, end)
  const ensure = body.indexOf('await ensureChatGPTReasoningEffort({')
  const observe = body.indexOf("executeChatGPTDOMScript(key, target.entry, 'reasoning-effort-state'")
  const cycle = body.indexOf('await stepChatGPTReasoningEffortToward(key, target.entry, reasoningEffort)')
  const submit = body.indexOf('submitWithoutReplay({')
  assert.ok(ensure >= 0 && observe > ensure && cycle > observe && submit > cycle)
  assert.match(body, /normalizeChatGPTReasoningEffort\(target\.reasoningEffort \|\| target\.entry\.reasoningEffort \|\| 'high'\)/)
})

// Live-captured 2026-09: ChatGPT replaced the effort control's dedicated
// Ctrl+Shift+M shortcut with a genuine ARIA slider inside the picker menu.
// A real Chromium-level key dispatch to the old shortcut reaches the page
// (confirmed live via CDP, ruling out a WebContentsView focus/layout gap) and
// still does nothing, because nothing listens for it any more - every
// TODO_CLASSIFY attempt that tolerated the resulting failure submitted at
// whatever level the account was already on instead of the requested
// 'instant', and a thinking model given a trivial classification at a high
// effort level blew through the 4-minute response timeout on every attempt.
// Live testing against the real ChatGPT account has already found the
// effort control unreachable once (a dead keyboard shortcut, fixed by
// stepChatGPTReasoningEffortToward) and could again - a future UI change is
// not something this test predicts. `submitChatGPTDraft`'s default behavior
// must stay fail-closed for correctness-sensitive planning exchanges
// regardless of why the effort is unreachable, so the bypass has to be
// explicit per caller, not a change to the default.
test('an unreachable reasoning effort still blocks submission unless a caller explicitly opts out', async () => {
  const source = await readActivityRecoverySource()
  const start = source.indexOf('async function submitChatGPTDraft(')
  const end = source.indexOf('\nasync function preparePromptForChatGPT', start)
  assert.notEqual(start, -1)
  const body = source.slice(start, end)
  assert.match(body, /if \(requireReasoningEffort\) throw error/)

  // Only the two background bundle-only workers (TODO classification and
  // markdown translation) may opt out; every other caller keeps the default.
  const classifyStart = source.indexOf('async function executeChatAgentTodoClassification(task, entry, key, payload)')
  const classifyEnd = source.indexOf('\nasync function chatAgentLifecycleRetry', classifyStart)
  assert.match(source.slice(classifyStart, classifyEnd), /submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target, \{ requireReasoningEffort: false, rateLimitExempt: false \}\)/)

  const translateStart = source.indexOf('async function executeChatAgentMarkdownTranslation(task, entry, key, payload)')
  const translateEnd = source.indexOf('\nasync function executeChatAgentTodoClassification', translateStart)
  assert.match(source.slice(translateStart, translateEnd), /submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target, \{ requireReasoningEffort: false, rateLimitExempt: true \}\)/)

  const botWriteCount = (body.match(/requireReasoningEffort: false/g) || []).length
  assert.equal(botWriteCount, 0, 'submitChatGPTDraft itself must keep failing closed by default')
})
