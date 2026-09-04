import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('prepare-prompt uses the background composer targeting helper', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function preparePromptForChatGPT(request)')
  const end = source.indexOf('\nasync function submitPreparedChatGPTDraft', start)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const preparePrompt = source.slice(start, end)
  assert.match(preparePrompt, /await targetChatGPTComposer\(key, linkedConversation \|\| CHATGPT_URL, linkedConversation \? request\?\.preferCurrentConversation === true : false\)/)
  assert.doesNotMatch(preparePrompt, /focusChatGPTComposer/)
})


test('manual toolbar send actions submit only after their upload is confirmed', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const contextStart = source.indexOf('async function attachContextToChatGPT(request)')
  const promptStart = source.indexOf('async function attachPromptToChatGPT(request)')
  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft', promptStart)

  assert.notEqual(contextStart, -1)
  assert.notEqual(promptStart, -1)
  assert.notEqual(preparedStart, -1)

  const contextSend = source.slice(contextStart, promptStart)
  const promptSend = source.slice(promptStart, preparedStart)
  for (const action of [contextSend, promptSend]) {
    const upload = action.indexOf('await pasteChatGPTFile')
    const submit = action.indexOf('await submitChatGPTDraft(key)')
    assert.notEqual(upload, -1)
    assert.notEqual(submit, -1)
    assert.ok(upload < submit)
    assert.match(action, /if \(!submission\.accepted\) throw new Error/)
  }
})


test('dual ChatGPT auth uses a real managed browser and never forwards an in-flight provider URL', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const routeStart = source.indexOf('function routeChatGPTNavigation(entry, event, url)')
  const routeEnd = source.indexOf('\nfunction observeEmbeddedAuthURL', routeStart)
  assert.notEqual(routeStart, -1)
  assert.notEqual(routeEnd, -1)
  const route = source.slice(routeStart, routeEnd)
  assert.match(route, /startExternalAuthentication\(entry, disposition\.provider \|\| 'OpenAI'\)/)
  assert.match(route, /disposition\.provider === 'Google'/)
  assert.doesNotMatch(route, /shell\.openExternal\(url\).*external-auth/s)

  const externalStart = source.indexOf('function startExternalAuthentication(entry, provider')
  const externalEnd = source.indexOf('\nfunction routeChatGPTNavigation', externalStart)
  const externalAuth = source.slice(externalStart, externalEnd)
  assert.match(externalAuth, /launchManagedBrowserAuth/)
  assert.match(externalAuth, /loginURL: CHATGPT_LOGIN_URL/)
  assert.doesNotMatch(externalAuth, /new BrowserWindow/)
})


test('bundle fallback snapshots assistant-turn baseline before each planner submit', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  const baseline = prepare.indexOf('await chatGPTAssistantTurnCount(target.wc)')
  const submit = prepare.indexOf('await submitChatGPTDraft(key)')
  const arm = prepare.indexOf('armExpectedChatGPTBundle(key, requestId, assistantBaseline)')
  assert.ok(baseline >= 0 && submit > baseline && arm > submit)

  const repairStart = source.indexOf('async function submitPromptToChatGPT')
  const repairEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', repairStart)
  const repair = source.slice(repairStart, repairEnd)
  assert.match(repair, /const assistantBaseline = await chatGPTAssistantTurnCount\(target\.wc\)/)
  assert.match(repair, /armExpectedChatGPTBundle\(key, requestId, assistantBaseline\)/)
})

test('external auth reuses the persistent Wharness browser profile and clear-session owns deletion', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const externalStart = source.indexOf('function startExternalAuthentication(entry, provider')
  const externalEnd = source.indexOf('\nfunction routeChatGPTNavigation', externalStart)
  assert.notEqual(externalStart, -1)
  assert.notEqual(externalEnd, -1)
  const externalAuth = source.slice(externalStart, externalEnd)
  assert.match(externalAuth, /const profileDir = managedAuthProfilePath\(\)/)
  assert.doesNotMatch(externalAuth, /app\.getPath\('temp'\)/)
  assert.doesNotMatch(externalAuth, /rm\(record\.profileDir/)

  const clearStart = source.indexOf('async function clearBrowserSession()')
  const clearEnd = source.indexOf('\nasync function desktopStorageUsage', clearStart)
  assert.notEqual(clearStart, -1)
  assert.notEqual(clearEnd, -1)
  assert.match(source.slice(clearStart, clearEnd), /rm\(managedAuthProfilePath\(\), \{ recursive: true, force: true/)
})


test('desktop owns the new-chat affinity handshake and renderer only confirms or rejects its candidate', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /\.\.\.publicChatGPTAffinity\(entry\?\.affinity\)/)
  assert.match(source, /observeChatGPTAffinityURL\(cacheKey, entry, url\)/)
  assert.match(source, /syncChatGPTAffinityURL\(key, entry, linkedConversation\)/)
  assert.match(source, /wharness:chatgpt:confirm-affinity/)
  assert.match(source, /confirmChatGPTAffinity\(entry\.affinity, request\?\.conversationUrl, wc\.getURL\(\)\)/)
  assert.match(source, /wharness:chatgpt:reject-affinity/)
  assert.match(source, /rejectChatGPTAffinity\(entry\.affinity, rejectedURL\)/)
  assert.match(source, /markChatGPTAffinitySubmitted\(target\.entry\.affinity\)/)
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  assert.match(prepare, /linkedConversation \|\| CHATGPT_URL/)
  assert.match(prepare, /syncChatGPTAffinityURL\(key, target\.entry\)/)
})

test('automatic and confirmed submissions wait for a stable loaded definitive ChatGPT conversation URL', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const waiterStart = source.indexOf('async function waitForConcreteChatGPTConversation')
  const waiterEnd = source.indexOf('\nasync function fetchContextZip', waiterStart)
  const waiter = source.slice(waiterStart, waiterEnd)
  assert.match(waiter, /!wc\.isLoading\(\) && Date\.now\(\) - stableSince >= 600/)
  assert.match(waiter, /waitForConcreteChatGPTConversation\(wc, fallback, 30_000\)/)
  assert.match(waiter, /settleChatGPTAffinityAfterSubmit\(cacheKey, entry, conversationURL\)/)

  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft(cacheKey)')
  const preparedEnd = source.indexOf('\nasync function', preparedStart + 20)
  const prepare = source.slice(prepareStart, prepareEnd)
  const submitted = source.slice(preparedStart, preparedEnd > preparedStart ? preparedEnd : undefined)
  assert.match(prepare, /conversationUrl = await waitForSubmittedChatGPTConversation\(key, target\.entry, target\.conversationUrl\)/)
  assert.match(submitted, /const conversationUrl = await waitForSubmittedChatGPTConversation\(key, entry\)/)
  assert.match(submitted, /return \{ ok: true, cacheKey: key, expectedFilename, conversationUrl \}/)
})

test('expected bundle polling rehydrates recoverable ChatGPT transport and stalled processing failures', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /noteChatGPTNetworkFailure\(details\)/)
  assert.match(source, /noteChatGPTRendererFault\(cacheKey, description\)/)
  assert.match(source, /noteChatGPTRendererFault\(cacheKey, 'renderer unresponsive'\)/)
  const pollStart = source.indexOf('async function performChatGPTRecoveryAction')
  const pollEnd = source.indexOf('\nasync function exportBrowserSession', pollStart)
  const recovery = source.slice(pollStart, pollEnd)
  assert.match(recovery, /chooseChatGPTRecoveryAction/)
  assert.match(recovery, /const completionSettled = completion\?\.complete === true/)
  assert.match(recovery, /now - expected\.settledAt >= BUNDLE_COMPLETION_GRACE_MS/)
  assert.match(recovery, /wc\.reload\(\)/)
  assert.match(recovery, /chatGPTStalledRecoveryPrompt\(expected\.requestId, expected\.filename\)/)
  assert.match(recovery, /await submitChatGPTDraft\(key\)/)
})

test('desktop ChatGPT state publishes only a boolean authentication result to the renderer', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /authenticated: Boolean\(entry\?\.authenticated\)/)
  assert.match(source, /executeJavaScript\(chatGPTSessionProbeExpression\(\), true\)/)
})

test('in-flight comments defer stale bundle capture and rearm after the comment submit', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const commentStart = source.indexOf('async function flushQueuedChatGPTComments()')
  const commentEnd = source.indexOf('\nasync function pollChatGPTVisibleActivity', commentStart)
  const comments = source.slice(commentStart, commentEnd)
  assert.match(comments, /const assistantBaseline = await chatGPTAssistantTurnCount\(target\.wc\)/)
  assert.match(comments, /await submitChatGPTDraft\(key\)/)
  assert.match(comments, /armExpectedChatGPTBundle\(key, pending\.requestId, assistantBaseline\)/)

  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloads()')
  const pollEnd = source.indexOf('\nasync function exportBrowserSession', pollStart)
  const polling = source.slice(pollStart, pollEnd)
  assert.match(polling, /if \(hasPendingChatGPTComments\(key\)\) continue/)
  assert.match(polling, /chatGPTResponseCompletionScript\(expected\.assistantBaseline\)/)
  assert.match(polling, /WHARNESS DELIVERY CONTINUATION/)
})

test('task comments use a single-flight queue with recent idempotency protection', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /const flushingChatGPTComments = new Set\(\)/)
  assert.match(source, /if \(flushingChatGPTComments\.has\(key\)\) continue/)
  assert.match(source, /recentChatGPTCommentIds\.set\(`\$\{key\}:\$\{pending\.commentId\}`/)
  assert.match(source, /recentChatGPTCommentFingerprints\.set\(pending\.fingerprint/)
  assert.match(source, /item\.commentId === commentId \|\| item\.fingerprint === fingerprint/)
  assert.match(source, /duplicate: true/)
})

test('Portuguese spell checking is configured from Chromium dictionaries', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /availableSpellCheckerLanguages/)
  assert.match(source, /'pt-PT', 'pt-BR', 'en-US'/)
  assert.match(source, /setSpellCheckerLanguages/)
})


test('each Harness chat owns a dedicated ChatGPT WebContentsView and DOM IPC stays key-scoped', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')
  const createStart = source.indexOf('function createChatGPTView(cacheKey, windowState)')
  const createEnd = source.indexOf('\nfunction ensureChatGPTView', createStart)
  const targetStart = source.indexOf('async function targetChatGPTComposer(cacheKey')
  const targetEnd = source.indexOf('\nasync function waitForChatGPTSurfaceReady', targetStart)
  assert.notEqual(createStart, -1)
  assert.notEqual(createEnd, -1)
  assert.notEqual(targetStart, -1)
  assert.notEqual(targetEnd, -1)

  const create = source.slice(createStart, createEnd)
  const target = source.slice(targetStart, targetEnd)
  assert.match(create, /ownerKey: cacheKey/)
  assert.match(create, /ownerWindowId: windowState\.id/)
  assert.match(source, /const desktopWindows = new Map\(\)/)
  assert.match(source, /const projectWindowRegistry = new ProjectWindowRegistry\(\)/)
  assert.match(source, /wharness:projects:acquire/)
  assert.match(source, /wharness:windows:open/)
  assert.match(source, /persistRestartIntent\(scope, windowState\.id\)/)
  assert.match(source, /consumeRestartIntent\(\)/)
  assert.match(source, /import \{ mkdirSync, readFileSync, rmSync, writeFileSync \} from 'node:fs'/)
  assert.match(source, /createWindow\(restartIntent\.currentWindowId, false\)/)
  assert.match(source, /function requireOwnedChatGPTEntry\(cacheKey, entry\)/)
  assert.match(source, /chatgptViews\.get\(key\) !== entry/)
  assert.match(target, /requireOwnedChatGPTEntry\(key, entry\)/)
  assert.doesNotMatch(source, /MAX_CHATGPT_VIEWS|evictChatGPTViews/)

  assert.match(preload, /hide: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /state: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /reload: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /paste: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /release: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(source, /wharness:chatgpt:release/)
  assert.match(source, /publishBundleDownload\(\{ cacheKey: sourceCacheKey, filename/)
  assert.match(source, /publishPlanDownload\(\{ cacheKey: sourceCacheKey, filename/)
})
