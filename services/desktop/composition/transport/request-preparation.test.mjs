import { readPromptTransportSource } from './prompt-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readDesktopCompositionSource } from '../entry/source.mjs'

test('prepare-prompt uses the background composer targeting helper', async () => {
  const source = await readPromptTransportSource()
  const start = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const end = source.indexOf('\nasync function submitPreparedChatGPTDraft', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const preparePrompt = source.slice(start, end)
  assert.match(preparePrompt, /await targetChatGPTComposer\(key, linkedConversation \|\| CHATGPT_URL, linkedConversation \? request\?\.preferCurrentConversation === true : false, entryOverride\)/)
  assert.doesNotMatch(preparePrompt, /focusChatGPTComposer/)
})

test('a prepared upload is submitted atomically without retargeting or reloading its composer', async () => {
  const source = await readPromptTransportSource()
  const submitStart = source.indexOf('async function submitChatGPTDraft(')
  const submitEnd = source.indexOf('\nasync function preparePromptForChatGPT', submitStart)
  const submit = source.slice(submitStart, submitEnd)
  const prepareStart = submitEnd
  const prepareEnd = source.indexOf('\nasync function queuePreparedPromptForWorker', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  assert.match(submit, /preparedTarget/)
  assert.match(submit, /preparedTarget \|\| await targetChatGPTComposer/)
  assert.match(prepare, /submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target, \{ rateLimitExempt: !pacedWorker, requireReasoningEffort: !orchestratorTask \}\)/)
})

test('manual retry through a Supervisor is never deferred by the Worker rate-limit cooldown', async () => {
  const source = await readPromptTransportSource()
  const retryIPC = await readFile(new URL('../../chatgpt/transport/requests/ipc/prompt.mjs', import.meta.url), 'utf8')
  assert.match(source, /registerChatGPTPromptIPC\(\{/)
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(')
  const prepare = source.slice(prepareStart, source.indexOf('\nasync function queuePreparedPromptForWorker', prepareStart))
  const submitStart = source.indexOf('async function submitChatGPTDraft(')
  const submit = source.slice(submitStart, prepareStart)

  assert.match(retryIPC, /withChatGPTSupervisorTransport\([\s\S]*retryPreparedChatGPTPrompt\(request, entry\)/)
  assert.match(prepare, /\{ pacedWorker = false \} = \{\}/)
  assert.match(prepare, /rateLimitExempt: !pacedWorker/)
  assert.match(submit, /rateLimitExempt = true/)
})

test('manual preparation records the supplied title and cannot leave an orphan draft through an undefined variable', async () => {
  const source = await readPromptTransportSource()
  const start = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const end = source.indexOf('\nasync function queuePreparedPromptForWorker', start)
  const prepare = source.slice(start, end)

  assert.match(prepare, /const requestedTitle = String\(request\?\.chatTitle \|\| ''\)/)
  assert.match(prepare, /chatTitle: requestedTitle/)
})

test('observing a submit does not erase the retryable prompt, only a real terminal outcome does', async () => {
  const source = await readPromptTransportSource()
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const retryDeclStart = source.indexOf('\nasync function retryPersistedChatGPTPrompt(request, entryOverride = undefined)')
  const prepareOwnBody = source.slice(prepareStart, retryDeclStart)
  // A conversation POST being observed only confirms transport, not that
  // ChatGPT actually received the composed prompt/attachment — the retry
  // entry must survive that observation so a manual resend stays possible.
  assert.doesNotMatch(prepareOwnBody, /retryableChatGPTPrompts\.delete\(key\)/)

  const inbox = await readFile(new URL('../session/pending-bundle-inbox.mjs', import.meta.url), 'utf8')
  const transportRuntime = await readFile(new URL('../session/transport-runtime.mjs', import.meta.url), 'utf8')
  const main = await readDesktopCompositionSource()
  const workflow = await readFile(new URL('../session/workflow/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /compose\(ctx, 'chat-workflow', createDesktopChatWorkflowRuntime, \{/)
  assert.match(workflow, /createDesktopChatTransportRuntime\(\{/)
  assert.match(transportRuntime, /cancelRequest: cancelChatGPTRequestState/)
  assert.match(inbox, /await cancelRequest\(key, id\)/)
  const bundleSource = await readFile(new URL('../../chatgpt/downloads/bundle.mjs', import.meta.url), 'utf8')
  assert.match(source, /pendingDeliveries: pendingChatGPTBundleDeliveries/)
  assert.match(bundleSource, /pendingDeliveries\.set\(validated\.requestId/)
})

test('resending a prepared prompt refuses to act on a request that has since been superseded', async () => {
  const source = await readPromptTransportSource()
  const retryStart = source.indexOf('async function retryPreparedChatGPTPrompt(request, entryOverride = undefined)')
  const retryEnd = source.indexOf('\nasync function attachContextToChatGPT', retryStart)
  const retryBody = source.slice(retryStart, retryEnd)
  assert.match(retryBody, /String\(retryable\.request\?\.requestId \|\| ''\) !== requestId/)
  assert.match(retryBody, /Uma requisição mais recente substituiu esta/)
  assert.match(await readFile(new URL('../../chatgpt/transport/requests/ipc/prompt.mjs', import.meta.url), 'utf8'), /retryPreparedChatGPTPrompt\(request, entry\)/)
})

test('retrying delivery after its bundle arrived is idempotent instead of reporting missing prompt state', async () => {
  const source = await readPromptTransportSource()
  const retryStart = source.indexOf('async function retryPreparedChatGPTPrompt(request, entryOverride = undefined)')
  const retryEnd = source.indexOf('\nasync function attachContextToChatGPT', retryStart)
  const retryBody = source.slice(retryStart, retryEnd)
  const timing = await readFile(new URL('../../chatgpt/config/runtime-timing.mjs', import.meta.url), 'utf8')
  assert.match(source, /DELIVERED_BUNDLE_DEDUP_TTL_MS/)
  assert.match(timing, /export const DELIVERED_BUNDLE_DEDUP_TTL_MS = RETRYABLE_PROMPT_TTL_MS/)
  assert.match(retryBody, /recentlyDeliveredChatGPTBundleRequestId\(requestId\)/)
  assert.match(retryBody, /alreadyDelivered: true/)
})

test('manual toolbar send actions submit only after their upload is confirmed', async () => {
  const source = await readPromptTransportSource()
  const contextStart = source.indexOf('async function attachContextToChatGPT(request, entryOverride = undefined)')
  const promptStart = source.indexOf('async function attachPromptToChatGPT(request, entryOverride = undefined)')
  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft', promptStart)

  assert.notEqual(contextStart, -1)
  assert.notEqual(promptStart, -1)
  assert.notEqual(preparedStart, -1)

  const contextSend = source.slice(contextStart, promptStart)
  const promptSend = source.slice(promptStart, preparedStart)
  for (const action of [contextSend, promptSend]) {
    const upload = action.indexOf('await pasteChatGPTFile')
    const submit = action.indexOf('await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)')
    assert.notEqual(upload, -1)
    assert.notEqual(submit, -1)
    assert.ok(upload < submit)
    assert.match(action, /if \(!submission\.accepted\) throw new Error/)
  }
})

test('Desktop sends one logical request and uses configured multipart transport only when needed', async () => {
  const source = await readPromptTransportSource()
  const attachments = await readFile(new URL('../../chatgpt/transport/attachments/attachments.mjs', import.meta.url), 'utf8')
  assert.match(attachments, /async function fetchChatTransportLimits\(signal\)/)
  const start = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const end = source.indexOf('\nasync function attachContextToChatGPT', start)
  const prepare = source.slice(start, end)
  assert.match(prepare, /materializeChatInput\([^\n]+directPrompt/)
  assert.match(prepare, /localChatInputBootstrap\(requestId, input\.archiveName, expectedFilename, \[\], input\.requestMetadata, input\.multipart\)/)
  assert.match(prepare, /for \(let index = 0; index < input\.uploadPaths\.length; index \+= 1\) await pasteChatGPTFile/)
  assert.match(prepare, /attachmentCount: input\.uploadPaths\.length/)
})

test('automatic ChatGPT transport accepts auto-approve projects', async () => {
  const main = await readDesktopCompositionSource()
  const guard = await readFile(new URL('./preparation/runtime.mjs', import.meta.url), 'utf8')
  const stage = await readFile(new URL('./stage/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /compose\(ctx, 'chatgpt-transport', createDesktopChatGPTTransportStage, \{/)
  assert.match(stage, /createDesktopRequestPreparation\(\{/)
  assert.match(guard, /\['auto', 'auto_approve'\]\.includes\(sessionState\?\.automation_mode\)/)
})

test('automatic and confirmed submissions wait for a stable loaded definitive ChatGPT conversation URL', async () => {
  const source = await readPromptTransportSource()
  const conversationURLs = await readFile(new URL('../../chatgpt/session/conversation-url.mjs', import.meta.url), 'utf8')
  const waiter = await readFile(new URL('../../chatgpt/session/ownership/conversation-settlement.mjs', import.meta.url), 'utf8')
  const main = await readDesktopCompositionSource()
  const stage = await readFile(new URL('./stage/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /compose\(ctx, 'chatgpt-transport', createDesktopChatGPTTransportStage, \{/)
  assert.match(stage, /createChatGPTConversationSettlement\(d\)/)
  assert.match(waiter, /!wc\.isLoading\(\) && Date\.now\(\) - stableSince >= 600/)
  assert.match(waiter, /waitForConcreteChatGPTConversation\(wc, 30_000\)/)
  assert.match(waiter, /settleChatGPTAffinityAfterSubmit\(cacheKey, entry, stableURL\)/)
  assert.match(waiter, /return ''/)
  assert.doesNotMatch(waiter, /finalURL \|\| canonicalChatGPTConversationURL/)
  assert.match(conversationURLs, /return \/\^\[A-Za-z0-9-\]\{1,128\}\$\/\.test\(id\) \? id : ''/)

  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft(')
  const preparedEnd = source.indexOf('\nasync function', preparedStart + 20)
  const prepare = source.slice(prepareStart, prepareEnd)
  const submitted = source.slice(preparedStart, preparedEnd > preparedStart ? preparedEnd : undefined)
  assert.match(prepare, /conversationUrl = await waitForSubmittedChatGPTConversation\(key, target\.entry, target\.conversationUrl\)/)
  assert.match(submitted, /const conversationUrl = await waitForSubmittedChatGPTConversation\(key, entry\)/)
  assert.match(submitted, /return \{ ok: true, cacheKey: key, expectedFilename, conversationUrl, scheduled: true \}/)
})

test('local request evidence is fetched concurrently before the ZIP is assembled', async () => {
  const source = await readPromptTransportSource()
  const start = source.indexOf('async function materializeChatInput(')
  const end = source.indexOf('\nasync function materializeProtocolChatInput', start)
  const materialize = source.slice(start, end)
  assert.match(materialize, /Promise\.all\(\[\s*fetchRequestKnowledge\([\s\S]*fetchRequestGitContext\([\s\S]*fetchRequestContinuation\(/)
})
