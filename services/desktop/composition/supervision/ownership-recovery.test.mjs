import { readActivityRecoverySource } from './activity-recovery-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('reloading a bound Supervisor restores its linked conversation before refreshing', async () => {
  const source = await readActivityRecoverySource()
  const navigationIPC = await readFile(new URL('../../chatgpt/session/ipc/navigation.mjs', import.meta.url), 'utf8')
  const helper = await readFile(new URL('../../chatgpt/session/views/reload.mjs', import.meta.url), 'utf8')
  assert.match(source, /reloadOwnedChatGPTConversation/)
  assert.match(await readFile(new URL('../transport/stage/runtime.mjs', import.meta.url), 'utf8'), /createOwnedChatGPTConversationReload\(\{/)
  assert.match(helper, /canonicalChatGPTConversationURL\(entry\.affinity\.boundURL \|\| ''\)/)
  assert.match(helper, /linkedConversation && !sameConversationURL\(wc\.getURL\(\), linkedConversation\)/)
  assert.match(helper, /await loadOwnedChatGPTURL\(key, entry, linkedConversation, `\$\{reason\}-linked`\)/)

  const reloadStart = navigationIPC.indexOf("ipcMain.handle('wharness:chatgpt:reload'")
  const reloadEnd = navigationIPC.indexOf("ipcMain.handle('wharness:chatgpt:back'", reloadStart)
  const reload = navigationIPC.slice(reloadStart, reloadEnd)
  assert.match(source, /registerChatGPTSurfaceIPC\(\{/)
  assert.match(reload, /await reloadOwnedChatGPTConversation\(key, entry, 'manual-reload'\)/)
})

test('Supervisor transport keeps the captured chat entry and exposes no focus IPC', async () => {
  const [source, promptIPC, preload] = await Promise.all([
    readActivityRecoverySource(),
    readFile(new URL('../../chatgpt/transport/requests/ipc/prompt.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(source, /wharness:chatgpt:focus/)
  assert.doesNotMatch(preload, /wharness:chatgpt:focus/)
  assert.match(source, /registerChatGPTPromptIPC\(\{/)
  assert.match(promptIPC, /preparePromptForChatGPT\(request, entry\)/)
  assert.match(promptIPC, /retryPreparedChatGPTPrompt\(request, entry\)/)
  assert.match(promptIPC, /attachContextToChatGPT\(request, entry\)/)
  assert.match(promptIPC, /attachPromptToChatGPT\(request, entry\)/)
})

test('expected bundle polling rehydrates recoverable ChatGPT transport and stalled processing failures', async () => {
  const source = await readActivityRecoverySource()
  const supervisorView = await readFile(new URL('../../chatgpt/session/views/supervisor.mjs', import.meta.url), 'utf8')
  const networkActivity = await readFile(new URL('../../chatgpt/session/health/network-activity.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatGPTNetworkActivity\(\{/)
  assert.match(networkActivity, /noteChatGPTNetworkFailure\(details\)/)
  assert.match(supervisorView, /noteChatGPTRendererFault\(cacheKey, description\)/)
  assert.match(supervisorView, /noteChatGPTRendererFault\(cacheKey, 'renderer unresponsive'\)/)
  const pollStart = source.indexOf('async function performChatGPTRecoveryAction')
  const pollEnd = source.indexOf('\nconst browserSessionOperations', pollStart)
  const recovery = source.slice(pollStart, pollEnd)
  assert.match(recovery, /chooseChatGPTRecoveryAction\(expected\.recovery, \{\}, now, \{ faultOnly: true \}\)/)
  assert.match(recovery, /const transport = classifyChatGPTConversationTransport\(entry\.conversationRequests/)
  assert.match(recovery, /reconcileChatGPTConversationTransport\(entry\.conversationRequests, transport\)/)
  assert.match(recovery, /transportActive: transport\.state === 'active'/)
  assert.match(recovery, /const completionSettled = completion\?\.complete === true/)
  assert.match(recovery, /now - expected\.settledAt >= BUNDLE_COMPLETION_GRACE_MS/)
  assert.match(recovery, /await reloadOwnedChatGPTConversation\(key, entry, 'recovery-reload'\)/)
  assert.match(recovery, /submitChatGPTContinuation\(key, entry\.affinity\.boundURL, expected\.requestId, entry\)/)
  assert.doesNotMatch(recovery, /fillBundledChatGPTComposer/)
  assert.match(recovery, /escalateChatGPTContinuationFailure\(key, expected, error, 'automatic-recovery'\)/)
  assert.match(recovery, /withChatGPTTransportPreparation\(key, entry, expected\.requestId/)
  assert.match(recovery, /awaitingConversationAffinity: isChatGPTAffinityAwaitingSettlement\(entry\.affinity\)/)
  assert.match(recovery, /CHATGPT_AFFINITY_RECOVERY_GRACE_MS/)
})

test('a failed delivery wake-up escalates once without a second poll-loop submission path', async () => {
  const source = await readActivityRecoverySource()
  const recoveryStart = source.indexOf('async function performChatGPTRecoveryAction(')
  const recoveryEnd = source.indexOf('\nfunction escalateChatGPTContinuationFailure', recoveryStart)
  const recovery = source.slice(recoveryStart, recoveryEnd)
  assert.match(recovery, /submitChatGPTContinuation\(key, entry\.affinity\.boundURL, expected\.requestId, entry\)/)
  assert.match(recovery, /escalateChatGPTContinuationFailure\(key, expected, error, 'automatic-recovery'\)/)
  assert.match(recovery, /MAX_AUTOMATIC_BUNDLE_CONTINUATIONS/)
  assert.doesNotMatch(recovery, /expected\.recovery = createChatGPTRecoveryState/)

  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads()', pollStart)
  const poll = source.slice(pollStart, pollEnd)
  const afterRecovery = poll.slice(poll.indexOf('if (recoveryAction)'))
  assert.doesNotMatch(afterRecovery, /submitChatGPTContinuation/)
})

test('pending bundles resume only after the bound DOM proves the original request archive', async () => {
  const source = await readActivityRecoverySource()
  const resume = await readFile(new URL('../../chatgpt/transport/downloads/recovery/resume.mjs', import.meta.url), 'utf8')
  assert.match(source, /registerExpectedBundleRecoveryIPC\(\{/)
  assert.match(resume, /ipcMain\.handle\('wharness:chatgpt:resume-expected-bundle'/)
  assert.match(resume, /const conversation = canonicalChatGPTConversationURL\(target\)/)
  assert.match(resume, /chatAgentScheduler\.list\(\{ request_id: requestId \}\)/)
  assert.match(resume, /classifyChatGPTRequestDelivery/)
  assert.match(resume, /reason: 'write_in_progress'/)
  assert.match(resume, /reason: 'write_not_submitted'/)
  assert.doesNotMatch(resume, /retryPreparedChatGPTPrompt/)
  assert.match(resume, /ensureChatGPTView\(key, windowState\)/)
  assert.match(resume, /chatGPTSubmittedRequestEvidenceScript\(chatInputArchiveFilename\(key, requestId\)\)/)
  assert.match(resume, /reason: 'resend_required'/)
  assert.ok(resume.indexOf('const submissionEvidence') < resume.indexOf('armExpectedChatGPTBundle(key,'))
  assert.match(resume, /const workspaceChatId = durableWorkspaceChatID\(key, request\?\.workspaceChatId\)/)
  assert.match(resume, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort\(workspaceChatId, conversation, \{ remoteState: 'awaiting-response' \}\)/)
  assert.match(resume, /armExpectedChatGPTBundle\(key, requestId, 0, recoveryPrompt/)
  assert.match(resume, /recoveryEligibleAt = Date\.now\(\) \+ chatAgentInitialRequestWaitMs\(\)/)
  assert.match(resume, /expectedChatAgentPayload\(key, requestId, conversation/)
  assert.match(resume, /enqueueChatAgentTask\('AWAIT_RESPONSE'/)
  assert.match(resume, /dedupeKey: `await:\$\{requestId\}`/)
  assert.match(resume, /maxAttempts: 30/)
  assert.match(resume, /scheduled: true/)
  assert.doesNotMatch(resume, /setVisible\(false\)/)
  assert.doesNotMatch(resume, /pollExpectedChatGPTDownloadKey\(key\)/)
})

test('manual resume sends keep-continue only after DOM proves the original request archive', async () => {
  const source = await readActivityRecoverySource()
  const resume = await readFile(new URL('../../chatgpt/transport/downloads/recovery/continue.mjs', import.meta.url), 'utf8')
  assert.match(resume, /chatGPTSubmittedRequestEvidenceScript\(chatInputArchiveFilename\(key, requestId\)\)/)
  assert.match(resume, /submissionEvidence\?\.submitted !== true/)
  assert.match(resume, /const latest = await chatAgentScheduler\.list\(\{ request_id: requestId \}\)/)
  assert.match(resume, /currentDelivery === 'writing' \|\| currentDelivery === 'submitted'/)
  assert.doesNotMatch(resume, /cancelLineage\(requestId\)/)
  assert.match(resume, /reason: 'resend_required'/)
  assert.ok(resume.indexOf('const submissionEvidence') < resume.indexOf('continuation = await submitChatGPTContinuation'))
})

test('a Supervisor releases its chat only after the request settled and another chat needs the slot', async () => {
  const source = await readActivityRecoverySource()

  const holdStart = source.indexOf('function supervisorBindingHold(')
  const hold = source.slice(holdStart, source.indexOf('\nfunction supervisorBindingHeld(', holdStart))
  for (const reason of ['expected-bundle', 'bundle-delivery', 'queued-comment', 'transport', 'account-operation', 'human-action', 'external-auth', 'supervisor-lease', 'prepared-prompt']) {
    assert.match(hold, new RegExp(`'${reason}'`), `${reason} must hold a Supervisor binding`)
  }

  const reusableStart = source.indexOf('function reusableSupervisor(')
  const reusable = source.slice(reusableStart, source.indexOf('\nfunction ensureChatGPTView(', reusableStart))
  assert.match(reusable, /!supervisorBindingHeld\(candidateKey, entry\)/)

  const bindStart = source.indexOf('function bindChatSupervisor(')
  const bind = source.slice(bindStart, source.indexOf('\nfunction noteChatSupervisorLane(', bindStart))
  assert.match(bind, /chatGPTEntryIsActiveVisible\(reusable\[0\], reusable\[1\]\)/)

  const evictStart = source.indexOf('function evictIdleChatGPTViews(')
  const evict = source.slice(evictStart, source.indexOf('\nfunction chatGPTSurfaceShouldBeVisible(', evictStart))
  // Retire only what the cap requires, oldest first, and never a held slot or
  // the visible one. Releasing on a timer would re-create the churn the binding
  // exists to remove.
  assert.match(evict, /const excess = chatgptViews\.size - getDesiredChatAgentSupervisorSlots\(\)/)
  assert.match(await readFile(new URL('../../main.mjs', import.meta.url), 'utf8'), /getDesiredChatAgentSupervisorSlots: \(\) => desktopState\.agent\.desiredChatAgentSupervisorSlots/)
  assert.match(evict, /!supervisorBindingHeld\(key, entry\) && !chatGPTEntryIsActiveVisible\(key, entry\)/)
  assert.match(evict, /if \(released >= excess\) break/)
  assert.doesNotMatch(source, /setInterval\([^)]*evictIdleChatGPTViews/)
})

test('Supervisor transport stays unthrottled while durable resume proves the bound DOM', async () => {
  const source = await readActivityRecoverySource()
  const transport = await readFile(new URL('../../chatgpt/transport/requests/transport-preparation.mjs', import.meta.url), 'utf8')
  const promptIPC = await readFile(new URL('../../chatgpt/transport/requests/ipc/prompt.mjs', import.meta.url), 'utf8')
  const helperStart = transport.indexOf('async function withChatGPTTransportPreparation(')
  const helperEnd = transport.indexOf('\n  return { abortChatGPTTransportPreparations', helperStart)
  const helper = transport.slice(helperStart, helperEnd)
  assert.match(helper, /transportPreparationCount[\s\S]*reconcileThrottle[\s\S]*try[\s\S]*await withTrace\([^\n]*, operation\)[\s\S]*finally[\s\S]*transportPreparationCount[\s\S]*reconcileThrottle/)
  for (const channel of ['submit-prompt', 'prepare-prompt', 'retry-prepared-prompt', 'attach-context', 'attach-prompt', 'submit-prepared']) {
    const start = promptIPC.indexOf(`ipcMain.handle('wharness:chatgpt:${channel}'`)
    const end = promptIPC.indexOf('\n  })', start)
    assert.match(promptIPC.slice(start, end), /withChatGPTSupervisorTransport/)
  }
  assert.match(source, /registerChatGPTPromptIPC\(\{/)
  assert.match(source, /withChatGPTSupervisorTransport[\s\S]*withChatGPTTransportPreparation/)
  const resume = await readFile(new URL('../../chatgpt/transport/downloads/recovery/resume.mjs', import.meta.url), 'utf8')
  assert.match(resume, /enqueueChatAgentTask\('AWAIT_RESPONSE'/)
  assert.match(resume, /withChatGPTTransportPreparation/)
  assert.match(source.slice(source.indexOf('async function flushQueuedChatGPTComments()'), source.indexOf('\nasync function pollChatGPTVisibleActivity')), /withChatGPTTransportPreparation/)
})

test('request cancellation clears only matching Desktop supervision state and a validated bundle clears stale human attention', async () => {
  const source = await readActivityRecoverySource()
  const cancel = await readFile(new URL('../../chatgpt/transport/requests/cancellation/cancel.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatGPTRequestCancellation\(\{/)
  const transportComposition = await readFile(new URL('../session/transport-runtime.mjs', import.meta.url), 'utf8')
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  assert.match(main, /scheduler: \(\) => desktopState\.agent\.chatAgentScheduler/)
  assert.match(transportComposition, /scheduler: d\.scheduler/)
  assert.match(cancel, /expected\?\.requestId === id/)
  assert.match(cancel, /retryable\?\.request\?\.requestId/)
  assert.match(cancel, /prepared\?\.requestId/)
  assert.match(cancel, /comment\?\.requestId/)
  assert.match(cancel, /clearChatGPTHumanAction/)
  assert.match(cancel, /abortChatGPTTransportPreparations\(key, id\)/)
  assert.match(cancel, /abortedPreparations/)
  assert.match(cancel, /activeScheduler\.cancelLineage\(id\)/)
  assert.match(cancel, /try\s*\{[\s\S]*await refreshChatAgentRuntimeState\(\)[\s\S]*\}\s*catch/)
  const promptIPC = await readFile(new URL('../../chatgpt/transport/requests/ipc/prompt.mjs', import.meta.url), 'utf8')
  assert.match(promptIPC, /wharness:chatgpt:cancel-request/)
  const ack = await readFile(new URL('../session/pending-bundle-inbox.mjs', import.meta.url), 'utf8')
  assert.match(source, /markDelivered: markChatGPTBundleRequestDelivered/)
  assert.match(source, /cancelRequest: cancelChatGPTRequestState/)
  assert.match(ack, /markDelivered\(id\)/)
  assert.match(ack, /await cancelRequest\(key, id\)/)
  const deliveryIPC = await readFile(new URL('../../chatgpt/transport/downloads/ipc/delivery.mjs', import.meta.url), 'utf8')
  assert.match(source, /registerChatGPTBundleIPC\(\{/)
  assert.match(deliveryIPC, /wharness:chatgpt:ack-bundle/)
})
