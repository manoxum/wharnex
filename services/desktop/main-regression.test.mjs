import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('workspace toolbar owns the themed title bar and window controls', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const createStart = source.indexOf('function createWindow(')
  const registerStart = source.indexOf('\nfunction registerIPC()', createStart)
  const create = source.slice(createStart, registerStart)
  assert.match(create, /frame: false/)
  assert.doesNotMatch(create, /titleBarOverlay/)
})


test('desktop windows restore their last normal size per window id', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const persistenceStart = source.indexOf('function windowLayoutPath()')
  const persistenceEnd = source.indexOf('\nfunction restartIntentPath()', persistenceStart)
  const persistence = source.slice(persistenceStart, persistenceEnd)
  const createStart = source.indexOf('function createWindow(')
  const registerStart = source.indexOf('\nfunction registerIPC()', createStart)
  const create = source.slice(createStart, registerStart)

  assert.match(persistence, /JSON\.stringify\(\{ version: 2, windows, sizes \}\)/)
  assert.match(persistence, /getNormalBounds/)
  assert.match(persistence, /function loadWindowSize\(id\)/)
  assert.match(create, /const initialWindowSize = loadWindowSize\(id\)/)
  assert.match(create, /width: initialWindowSize\.width/)
  assert.match(create, /height: initialWindowSize\.height/)
  assert.match(create, /win\.on\('resize', scheduleWindowLayoutPersistence\)/)
  assert.doesNotMatch(create, /windowStatePersistence/)
})

test('Linux Desktop uses software compositing to avoid GPU renderer traps', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /if \(process\.platform === 'linux'\) app\.disableHardwareAcceleration\(\)/)
})

test('agent Chromium workers start after the first local shell paint', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const delay = source.indexOf('CHAT_AGENT_STARTUP_DELAY_MS')
  assert.ok(delay !== -1)
  assert.match(source, /setTimeout\(async \(\) => \{[\s\S]*await primeChatGPTWorkerPool\(workerHost\)[\s\S]*chatAgentScheduler\.start\(\)[\s\S]*CHAT_AGENT_STARTUP_DELAY_MS/)
  assert.match(source, /createChatGPTWorkerView\(`worker-\$\{index \+ 1\}`, host\)[\s\S]*await wait\(CHAT_AGENT_WORKER_SPAWN_GAP_MS\)/)
})

test('hidden Worker views stay out of the local shell compositor until explicitly surfaced', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const createStart = source.indexOf('function createChatGPTWorkerView(')
  const createEnd = source.indexOf('\nfunction retireChatGPTWorkerView', createStart)
  const create = source.slice(createStart, createEnd)
  const showStart = source.indexOf('function showChatAgentInteraction(')
  const showEnd = source.indexOf('\nfunction setChatAgentInteractionBounds', showStart)
  const show = source.slice(showStart, showEnd)
  assert.match(create, /attached: false/)
  assert.doesNotMatch(create, /contentView\.addChildView\(view\)/)
  assert.match(show, /windowState\.window\.contentView\.addChildView\(entry\.view\)/)
  assert.match(show, /entry\.attached = true/)
})

test('renderer window controls are closed preload IPC operations', async () => {
  const [source, preload] = await Promise.all([
    readFile(new URL('./main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./preload.cjs', import.meta.url), 'utf8'),
  ])
  assert.match(source, /ipcMain\.handle\('wharness:windows:minimize'/)
  assert.match(source, /ipcMain\.handle\('wharness:windows:toggle-maximize'/)
  assert.match(source, /ipcMain\.handle\('wharness:windows:close'/)
  assert.match(preload, /minimize: \(\) => invoke\('wharness:windows:minimize'\)/)
  assert.match(preload, /toggleMaximize: \(\) => invoke\('wharness:windows:toggle-maximize'\)/)
  assert.match(preload, /close: \(\) => invoke\('wharness:windows:close'\)/)
})

test('local frontend navigation uses a per-runtime cache token', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /const FRONTEND_RUNTIME_TOKEN = randomUUID\(\)/)
  const createStart = source.indexOf('function createWindow(')
  const registerStart = source.indexOf('\nfunction registerIPC()', createStart)
  const create = source.slice(createStart, registerStart)
  assert.match(create, /target\.searchParams\.set\('wharnessRuntime', FRONTEND_RUNTIME_TOKEN\)/)
})

test('prepare-prompt uses the background composer targeting helper', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const end = source.indexOf('\nasync function submitPreparedChatGPTDraft', start)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const preparePrompt = source.slice(start, end)
  assert.match(preparePrompt, /await targetChatGPTComposer\(key, linkedConversation \|\| CHATGPT_URL, linkedConversation \? request\?\.preferCurrentConversation === true : false, entryOverride\)/)
  assert.doesNotMatch(preparePrompt, /focusChatGPTComposer/)
})

test('a prepared upload is submitted atomically without retargeting or reloading its composer', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const submitStart = source.indexOf('async function submitChatGPTDraft(')
  const submitEnd = source.indexOf('\nasync function preparePromptForChatGPT', submitStart)
  const submit = source.slice(submitStart, submitEnd)
  const prepareStart = submitEnd
  const prepareEnd = source.indexOf('\nasync function queuePreparedPromptForWorker', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)

  assert.match(submit, /preparedTarget/)
  assert.match(submit, /preparedTarget \|\| await targetChatGPTComposer/)
  assert.match(prepare, /submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target\)/)
})

test('manual preparation records the supplied title and cannot leave an orphan draft through an undefined variable', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const end = source.indexOf('\nasync function queuePreparedPromptForWorker', start)
  const prepare = source.slice(start, end)

  assert.match(prepare, /const requestedTitle = String\(request\?\.chatTitle \|\| ''\)/)
  assert.match(prepare, /chatTitle: requestedTitle/)
})

test('background planner continuations use hidden Workers and cannot focus or rebind a Supervisor', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const queueStart = source.indexOf('async function queuePreparedPromptForWorker(')
  const queueEnd = source.indexOf('\nasync function retryPersistedChatGPTPrompt', queueStart)
  const queued = source.slice(queueStart, queueEnd)
  assert.match(queued, /enqueueChatAgentTask\('BOT_WRITE'/)
  assert.match(queued, /operation: 'PREPARE_PROMPT'/)
  assert.doesNotMatch(queued, /ensureChatGPTView|withChatGPTSupervisorTransport|\.focus\(/)

  const handlerStart = source.indexOf("ipcMain.handle('wharness:chatgpt:prepare-prompt'")
  const handler = source.slice(handlerStart, source.indexOf('\n  })', handlerStart))
  assert.match(handler, /request\?\.background === true[\s\S]*queuePreparedPromptForWorker\(request\)/)

  const writeStart = source.indexOf('async function executeChatAgentWrite(')
  const write = source.slice(writeStart, source.indexOf('\nasync function enqueueOrganizeFromTitle', writeStart))
  assert.match(write, /payload\.operation === 'PREPARE_PROMPT'/)
  assert.match(write, /preparePromptForChatGPT\(safeRequest, entry\)/)

  const executionStart = source.indexOf('async function executeChatAgentTask(')
  const execution = source.slice(executionStart, source.indexOf('\n  switch \(task\.type\)', executionStart))
  assert.match(execution, /!conversationURL && !isTrustedChatGPTOrigin[\s\S]*CHATGPT_URL/)

  const submitStart = source.indexOf('async function submitChatGPTDraft(')
  const submit = source.slice(submitStart, source.indexOf('\nasync function preparePromptForChatGPT', submitStart))
  assert.doesNotMatch(submit, /dispatchChatGPTSubmit|\.focus\(/)
  assert.match(submit, /if \(!clicked\) throw new Error\('ChatGPT send button is unavailable'\)/)
})

test('reloading a bound Supervisor restores its linked conversation before refreshing', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const helperStart = source.indexOf('async function reloadOwnedChatGPTConversation(')
  const helperEnd = source.indexOf('\nasync function targetChatGPTComposer', helperStart)
  const helper = source.slice(helperStart, helperEnd)
  assert.notEqual(helperStart, -1)
  assert.match(helper, /canonicalChatGPTConversationURL\(entry\.affinity\.boundURL \|\| ''\)/)
  assert.match(helper, /linkedConversation && !sameConversationURL\(wc\.getURL\(\), linkedConversation\)/)
  assert.match(helper, /await loadOwnedChatGPTURL\(key, entry, linkedConversation, `\$\{reason\}-linked`\)/)

  const reloadStart = source.indexOf("ipcMain.handle('wharness:chatgpt:reload'")
  const reloadEnd = source.indexOf("ipcMain.handle('wharness:chatgpt:back'", reloadStart)
  const reload = source.slice(reloadStart, reloadEnd)
  assert.match(reload, /await reloadOwnedChatGPTConversation\(key, entry, 'manual-reload'\)/)
})

test('Supervisor transport keeps the captured chat entry and exposes no focus IPC', async () => {
  const [source, preload] = await Promise.all([
    readFile(new URL('./main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./preload.cjs', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(source, /wharness:chatgpt:focus/)
  assert.doesNotMatch(preload, /wharness:chatgpt:focus/)
  assert.match(source, /preparePromptForChatGPT\(request, entry\)/)
  assert.match(source, /retryPreparedChatGPTPrompt\(request, entry\)/)
  assert.match(source, /attachContextToChatGPT\(request, entry\)/)
  assert.match(source, /attachPromptToChatGPT\(request, entry\)/)
})

test('linked projects expose owning windows and can bring an existing owner forward', async () => {
  const [source, preload] = await Promise.all([
    readFile(new URL('./main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./preload.cjs', import.meta.url), 'utf8'),
  ])

  const projectsStart = source.indexOf("ipcMain.handle('wharness:windows:projects'")
  const focusStart = source.indexOf("ipcMain.handle('wharness:windows:focus-project'")
  const openStart = source.indexOf("ipcMain.handle('wharness:windows:open'", focusStart)
  assert.notEqual(projectsStart, -1)
  assert.notEqual(focusStart, -1)
  const projectsHandler = source.slice(projectsStart, focusStart)
  const focusHandler = source.slice(focusStart, openStart)
  assert.match(projectsHandler, /for \(const state of desktopWindows\.values\(\)\)/)
  assert.match(projectsHandler, /currentWindowId: current\.id/)
  assert.match(focusHandler, /canonicalProjectPath\(request\?\.projectPath\)/)
  assert.match(focusHandler, /sendToWindowState\(owner, 'wharness:windows:activate-project', \{ projectPath \}\)/)
  assert.match(focusHandler, /owner\.window\.show\(\); owner\.window\.focus\(\)/)
  assert.match(preload, /projects: \(\) => invoke\('wharness:windows:projects'\)/)
  assert.match(preload, /focusProject: \(projectPath\) => invoke\('wharness:windows:focus-project'/)
  assert.match(preload, /wharness:windows:activate-project/)
})

test('a failed prompt delivery remains retryable without asking the planner for a new prompt', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const retryStart = source.indexOf('async function retryPreparedChatGPTPrompt(request, entryOverride = undefined)')
  const retryEnd = source.indexOf('\nasync function attachContextToChatGPT', retryStart)
  assert.match(source.slice(prepareStart, prepareEnd), /retryableChatGPTPrompts\.set\(key, \{ request, preparedAt: Date\.now\(\) \}\)/)
  assert.match(source.slice(retryStart, retryEnd), /return preparePromptForChatGPT\(retryable\.request, entryOverride\)/)
  assert.match(source, /wharness:chatgpt:retry-prepared-prompt/)
})

test('observing a submit does not erase the retryable prompt, only a real terminal outcome does', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const retryDeclStart = source.indexOf('\nasync function retryPersistedChatGPTPrompt(request, entryOverride = undefined)')
  const prepareOwnBody = source.slice(prepareStart, retryDeclStart)
  // A conversation POST being observed only confirms transport, not that
  // ChatGPT actually received the composed prompt/attachment — the retry
  // entry must survive that observation so a manual resend stays possible.
  assert.doesNotMatch(prepareOwnBody, /retryableChatGPTPrompts\.delete\(key\)/)

  const ackStart = source.indexOf('async function acknowledgeChatGPTBundle(')
  const ackEnd = source.indexOf('\nfunction chatGPTPartitionPath', ackStart)
  assert.match(source.slice(ackStart, ackEnd), /cancelChatGPTRequestState\(key, id\)/)
  assert.match(source, /pendingChatGPTBundleDeliveries\.set\(validated\.requestId/)
})

test('resending a prepared prompt refuses to act on a request that has since been superseded', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const retryStart = source.indexOf('async function retryPreparedChatGPTPrompt(request, entryOverride = undefined)')
  const retryEnd = source.indexOf('\nasync function attachContextToChatGPT', retryStart)
  const retryBody = source.slice(retryStart, retryEnd)
  assert.match(retryBody, /String\(retryable\.request\?\.requestId \|\| ''\) !== requestId/)
  assert.match(retryBody, /Uma requisição mais recente substituiu esta/)
  assert.match(source, /retryPreparedChatGPTPrompt\(request, entry\)/)
})

test('retrying delivery after its bundle arrived is idempotent instead of reporting missing prompt state', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const retryStart = source.indexOf('async function retryPreparedChatGPTPrompt(request, entryOverride = undefined)')
  const retryEnd = source.indexOf('\nasync function attachContextToChatGPT', retryStart)
  const retryBody = source.slice(retryStart, retryEnd)
  assert.match(source, /const DELIVERED_BUNDLE_DEDUP_TTL_MS = RETRYABLE_PROMPT_TTL_MS/)
  assert.match(retryBody, /recentlyDeliveredChatGPTBundleRequestId\(requestId\)/)
  assert.match(retryBody, /alreadyDelivered: true/)
})

test('a visible ChatGPT page performs one bounded composer reload before requiring human attention', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function targetChatGPTComposer(cacheKey')
  const end = source.indexOf('\nasync function waitForChatGPTSurfaceReady', start)
  const target = source.slice(start, end)
  assert.match(target, /for \(let attempt = 0; attempt < 20; attempt \+= 1\)/)
  assert.match(target, /await wait\(250\)/)
  assert.match(target, /let ready = await composerReady\(\)/)
  assert.match(target, /wc\.reload\(\)/)
  assert.match(target, /await waitForChatGPTSurfaceReady\(key, entry\)/)
  assert.match(target, /await assertNoHumanGate\('health-after-composer-reload'\)/)
  assert.match(target, /ready = await composerReady\(\)/)
  assert.ok(target.indexOf('wc.reload()') < target.indexOf("setChatGPTHumanAction(key, 'surface'"))
  assert.match(target, /setChatGPTHumanAction\(key, 'surface'/)
  assert.match(target, /throw new Error\(chatGPTHumanActionMessage\('surface'\)\)/)
})

test('DOM composer calls retry a transient renderer evaluation failure and retain the failing stage', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const helperStart = source.indexOf('async function executeChatGPTDOMScript(')
  const helperEnd = source.indexOf('\nasync function targetChatGPTComposer', helperStart)
  const helper = source.slice(helperStart, helperEnd)
  assert.notEqual(helperStart, -1)
  assert.match(helper, /attempt <= 3/)
  assert.match(helper, /await waitForChatGPTSurfaceReady/)
  assert.match(helper, /\[chatgpt-dom\] stage=/)
  const targetStart = source.indexOf('async function targetChatGPTComposer(cacheKey')
  const targetEnd = source.indexOf('\nasync function waitForChatGPTSurfaceReady', targetStart)
  assert.match(source.slice(targetStart, targetEnd), /executeChatGPTDOMScript\(key, entry, stage, chatGPTHumanActionScript\(\)\)/)
  assert.match(source.slice(targetStart, targetEnd), /await assertNoHumanGate\('health'\)/)
  assert.match(source.slice(targetStart, targetEnd), /executeChatGPTDOMScript\(key, entry, 'composer-ready'/)
})


test('manual toolbar send actions submit only after their upload is confirmed', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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


test('internal ChatGPT browser reuses the isolated Electron partition without privileged preload', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')
  const start = source.indexOf('function openInternalChatGPTBrowser(windowState, value)')
  const end = source.indexOf('\nfunction createWindow(', start)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const internalBrowser = source.slice(start, end)
  assert.match(internalBrowser, /new BrowserWindow/)
  assert.match(internalBrowser, /securePreferences\(\{ partition: CHATGPT_PARTITION, backgroundThrottling: false \}\)/)
  assert.doesNotMatch(internalBrowser, /preload:/)
  assert.match(internalBrowser, /requireTrustedChatGPTURL/)
  assert.match(internalBrowser, /setWindowOpenHandler/)
  assert.match(internalBrowser, /will-navigate/)
  assert.match(source, /ipcMain\.handle\('wharness:chatgpt:open-internal'/)
  assert.match(source, /closeAllInternalChatGPTBrowsers\(\)/)
  assert.match(preload, /openInternal: \(url = ''\) => invoke\('wharness:chatgpt:open-internal'/)
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
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  const baseline = prepare.indexOf('await chatGPTAssistantTurnCount(target.wc)')
  const submit = prepare.indexOf('await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)')
  const arm = prepare.indexOf('armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, remoteInput?.tunnels || [], directPrompt, request?.sessionId, expectedFilename, input.requestMetadata)')
  assert.ok(baseline >= 0 && arm > baseline && submit > arm)

  const repairStart = source.indexOf('async function submitPromptToChatGPT')
  const repairEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', repairStart)
  const repair = source.slice(repairStart, repairEnd)
  assert.match(repair, /const assistantBaseline = await chatGPTAssistantTurnCount\(target\.wc\)/)
  assert.match(repair, /armExpectedChatGPTBundle\(key, requestId, assistantBaseline, bundled\.bootstrap, liveTunnels, text, sessionId, expectedFilename, requestMetadata\)/)
})

test('external auth reuses the persistent Wharnex browser profile and clear-session owns deletion', async () => {
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
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  assert.match(prepare, /linkedConversation \|\| CHATGPT_URL/)
  assert.match(prepare, /syncChatGPTAffinityURL\(key, target\.entry\)/)
})

test('Desktop always sends one request ZIP and selected tunnels only augment the direct bootstrap', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /function normalizeTunnelInstanceIDs\(value\)/)
  const start = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const end = source.indexOf('\nasync function attachContextToChatGPT', start)
  const prepare = source.slice(start, end)
  assert.match(prepare, /const tunnelInstanceIds = normalizeTunnelInstanceIDs\(request\?\.tunnelInstanceIds\)/)
  assert.match(prepare, /if \(tunnelInstanceIds\.length\) \{/)
  assert.match(prepare, /publishRemoteChatInput\([^\n]+tunnelInstanceIds, requestMetadata\)/)
  assert.match(prepare, /materializeChatInput\([^\n]+directPrompt/)
  assert.match(prepare, /localChatInputBootstrap\(requestId, input\.archiveName, expectedFilename, remoteInput\?\.tunnels \|\| \[\], input\.requestMetadata\)/)
  assert.doesNotMatch(prepare, /if \(!transportOptions\.requestArchive\)/)
  assert.doesNotMatch(prepare, /attachmentCount: 0/)
})

test('Desktop direct transport collapses prompt, context and attachments into one request ZIP', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /writeChatInputArchive/)
  const materializeStart = source.indexOf('async function materializeChatInput')
  const materializeEnd = source.indexOf('\nasync function materializeProtocolChatInput', materializeStart)
  const materialize = source.slice(materializeStart, materializeEnd)
  assert.match(materialize, /chatInputArchiveFilename\(cacheKey, requestId\)/)
  assert.match(materialize, /writeChatInputArchive\(archivePath/)
  assert.doesNotMatch(materialize, /paths\.push/)

  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  assert.match(prepare, /localChatInputBootstrap\(requestId, input\.archiveName, expectedFilename, remoteInput\?\.tunnels \|\| \[\], input\.requestMetadata\)/)
  assert.match(prepare, /await pasteChatGPTFile\(target\.entry, input\.archivePath, 1, 1\)/)
  assert.match(prepare, /attachmentCount: 1/)
  assert.doesNotMatch(prepare, /transport=remote[^\n]+tunnels=/)
  assert.match(prepare, /return \{ ok: true, cacheKey: key, attachmentCount: 1/)
  assert.doesNotMatch(prepare, /for \(let index = 0; index < transportPaths\.length/)
})

test('automatic and confirmed submissions wait for a stable loaded definitive ChatGPT conversation URL', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const waiterStart = source.indexOf('async function waitForConcreteChatGPTConversation')
  const waiterEnd = source.indexOf('\nasync function fetchContextZip', waiterStart)
  const waiter = source.slice(waiterStart, waiterEnd)
  assert.match(waiter, /!wc\.isLoading\(\) && Date\.now\(\) - stableSince >= 600/)
  assert.match(waiter, /waitForConcreteChatGPTConversation\(wc, 30_000\)/)
  assert.match(waiter, /settleChatGPTAffinityAfterSubmit\(cacheKey, entry, stableURL\)/)
  assert.match(waiter, /return ''/)
  assert.doesNotMatch(waiter, /finalURL \|\| canonicalChatGPTConversationURL/)
  assert.match(source, /return \/\^WEB\(\?:\:\|%3A\)\/i\.test\(id\) \? '' : id/)

  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft(')
  const preparedEnd = source.indexOf('\nasync function', preparedStart + 20)
  const prepare = source.slice(prepareStart, prepareEnd)
  const submitted = source.slice(preparedStart, preparedEnd > preparedStart ? preparedEnd : undefined)
  assert.match(prepare, /conversationUrl = await waitForSubmittedChatGPTConversation\(key, target\.entry, target\.conversationUrl\)/)
  assert.match(submitted, /const conversationUrl = await waitForSubmittedChatGPTConversation\(key, entry\)/)
  assert.match(submitted, /return \{ ok: true, cacheKey: key, expectedFilename, conversationUrl, scheduled: true \}/)
})

test('ChatGPT affinity state is published to the owner window even when another chat is visually active', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const publishStart = source.indexOf('function publishChatGPTState')
  const publishEnd = source.indexOf('\nfunction isChatGPTNewChatSurfaceURL', publishStart)
  const publish = source.slice(publishStart, publishEnd)
  assert.match(publish, /windowStateForEntry\(entry\)/)
  assert.match(publish, /sendToWindowState\(state, 'wharness:chatgpt:state'/)
  assert.doesNotMatch(publish, /state\.activeChatGPTKey !== key/)
})


test('new ChatGPT views open the requested conversation as part of their first visible show', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const createStart = source.indexOf('function createChatGPTView(cacheKey, windowState)')
  const createEnd = source.indexOf('\nfunction ensureChatGPTView', createStart)
  const create = source.slice(createStart, createEnd)
  assert.match(create, /loading: false/)
  assert.match(create, /loadingSince: 0/)
  assert.doesNotMatch(create, /loadURL\(CHATGPT_URL/)

  const showStart = source.indexOf("ipcMain.handle('wharness:chatgpt:show'")
  const showEnd = source.indexOf("ipcMain.handle('wharness:chatgpt:hide'", showStart)
  const show = source.slice(showStart, showEnd)
  assert.match(show, /const initialTarget = request\?\.url \? requireTrustedChatGPTURL\(request\.url\) : CHATGPT_URL/)
  assert.match(show, /loadOwnedChatGPTURL\(request\?\.cacheKey, entry, initialTarget, 'initial-show'\)/)
  assert.match(show, /isTrustedChatGPTOrigin\(wc\.getURL\(\)\)/)
  assert.match(show, /waitForChatGPTSurfaceReady/)

  const loadStart = source.indexOf('async function loadOwnedChatGPTURL')
  const loadEnd = source.indexOf('\nfunction createChatGPTView', loadStart)
  const load = source.slice(loadStart, loadEnd)
  assert.match(load, /reason === 'initial-show'/)
  assert.match(load, /initial navigation stalled; retrying once/)
  assert.match(load, /'initial-show-retry'/)
})

test('desktop disables a broken IPv6 browser route before Electron becomes ready', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const switchAt = source.indexOf("app.commandLine.appendSwitch('disable-ipv6')")
  const readyAt = source.indexOf('app.whenReady()')
  assert.ok(switchAt >= 0 && switchAt < readyAt)
})

test('renderer navigation preserves overlay-driven ChatGPT visibility', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("ipcMain.handle('wharness:chatgpt:navigate'")
  const end = source.indexOf("ipcMain.handle('wharness:chatgpt:confirm-affinity'", start)
  const navigate = source.slice(start, end)
  assert.doesNotMatch(navigate, /windowState\.chatgptVisible = true/)
  assert.match(navigate, /activateChatGPTView\(key, request\?\.bounds, windowState\)/)
})

test('closing or switching the active project hides Supervisor and interactive Worker surfaces in Desktop before renderer teardown', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const suspendStart = source.indexOf('function suspendNativeSurfacesForWindow(windowState)')
  const suspendEnd = source.indexOf('\nfunction releaseProjectForWindow', suspendStart)
  const suspend = source.slice(suspendStart, suspendEnd)
  assert.ok(suspendStart >= 0)
  assert.match(suspend, /windowState\.chatgptVisible = false/)
  assert.match(suspend, /active\.view\.setVisible\(false\)/)
  assert.match(suspend, /hideChatAgentInteractionsForWindow\(windowState\)/)

  const releaseStart = source.indexOf('function releaseProjectForWindow(windowState, value)')
  const releaseEnd = source.indexOf('\nfunction releaseWindowProjects', releaseStart)
  assert.match(source.slice(releaseStart, releaseEnd), /activeProject === requested\) suspendNativeSurfacesForWindow\(windowState\)/)

  const activateStart = source.indexOf("ipcMain.handle('wharness:projects:activate'")
  const activateEnd = source.indexOf("ipcMain.handle('wharness:projects:bindings'", activateStart)
  assert.match(source.slice(activateStart, activateEnd), /activeProject !== projectPath\) suspendNativeSurfacesForWindow\(windowState\)/)
})

test('same-origin ChatGPT auth redirects stay embedded and explicit loads are serialized', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const routeStart = source.indexOf('function routeChatGPTNavigation')
  const routeEnd = source.indexOf('\nfunction observeEmbeddedAuthURL', routeStart)
  const route = source.slice(routeStart, routeEnd)
  assert.match(route, /disposition\.kind === 'chatgpt-auth'/)
  const authStart = route.indexOf("disposition.kind === 'chatgpt-auth'")
  const externalStart = route.indexOf("disposition.kind === 'external-auth'", authStart)
  const authBlock = route.slice(authStart, externalStart)
  assert.match(authBlock, /entry\.embeddedAuthActive = true/)
  assert.doesNotMatch(authBlock, /startExternalAuthentication/)

  const loadStart = source.indexOf('async function loadOwnedChatGPTURL')
  const loadEnd = source.indexOf('\nfunction createChatGPTView', loadStart)
  const load = source.slice(loadStart, loadEnd)
  assert.match(load, /entry\.navigationPromise/)
  assert.match(load, /isBenignChatGPTLoadAbort/)
  assert.match(load, /await wc\.loadURL\(target/)

  const createStart = source.indexOf('function createChatGPTView(cacheKey, windowState)')
  const createEnd = source.indexOf('\nfunction ensureChatGPTView', createStart)
  assert.match(source.slice(createStart, createEnd), /authMode: 'embedded'/)
})

test('navigation only observes affinity and a stable late observer performs definitive settlement', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const createStart = source.indexOf('function createChatGPTView(cacheKey, windowState)')
  const createEnd = source.indexOf('\nfunction ensureChatGPTView', createStart)
  const create = source.slice(createStart, createEnd)
  assert.match(create, /observeChatGPTAffinityURL\(cacheKey, entry, url\); scheduleChatGPTAffinitySettlement\(cacheKey, entry\)/)
  const settleStart = source.indexOf('function scheduleChatGPTAffinitySettlement')
  const settleEnd = source.indexOf('\nasync function refreshEmbeddedChatGPTAuthentication', settleStart)
  const settle = source.slice(settleStart, settleEnd)
  assert.match(settle, /waitForConcreteChatGPTConversation\(entry\.view\.webContents, 2_500\)/)
  assert.match(settle, /settleChatGPTAffinityAfterSubmit\(cacheKey, entry, stableURL\)/)

  const navigateStart = source.indexOf("ipcMain.handle('wharness:chatgpt:navigate'")
  const navigateEnd = source.indexOf("ipcMain.handle('wharness:chatgpt:confirm-affinity'", navigateStart)
  const navigate = source.slice(navigateStart, navigateEnd)
  assert.match(navigate, /shouldPreserveChatGPTAffinityNavigation\(entry\.affinity\)/)
  assert.match(navigate, /if \(!preservePendingConversation\) syncChatGPTAffinityURL/)
  assert.match(navigate, /!preservePendingConversation && unboundHomeIntent/)
  assert.match(navigate, /scheduleChatGPTAffinitySettlement\(key, entry\)/)
})

test('expected bundle polling rehydrates recoverable ChatGPT transport and stalled processing failures', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /noteChatGPTNetworkFailure\(details\)/)
  assert.match(source, /noteChatGPTRendererFault\(cacheKey, description\)/)
  assert.match(source, /noteChatGPTRendererFault\(cacheKey, 'renderer unresponsive'\)/)
  const pollStart = source.indexOf('async function performChatGPTRecoveryAction')
  const pollEnd = source.indexOf('\nasync function exportBrowserSession', pollStart)
  const recovery = source.slice(pollStart, pollEnd)
  assert.match(recovery, /chooseChatGPTRecoveryAction\(expected\.recovery, \{\}, now, \{ faultOnly: true \}\)/)
  assert.match(recovery, /const transport = classifyChatGPTConversationTransport\(entry\.conversationRequests/)
  assert.match(recovery, /reconcileChatGPTConversationTransport\(entry\.conversationRequests, transport\)/)
  assert.match(recovery, /transportActive: transport\.state === 'active'/)
  assert.match(recovery, /const completionSettled = completion\?\.complete === true/)
  assert.match(recovery, /now - expected\.settledAt >= BUNDLE_COMPLETION_GRACE_MS/)
  assert.match(recovery, /await reloadOwnedChatGPTConversation\(key, entry, 'recovery-reload'\)/)
  assert.match(recovery, /chatGPTStalledRecoveryPrompt\(expected\.requestId, expected\.filename, expected\.originalPrompt\)/)
  assert.match(recovery, /fillBundledChatGPTComposer\(key, entry, expected\.sessionId, expected\.requestId, prompt, expected\.filename/)
  assert.match(recovery, /escalateChatGPTContinuationFailure\(key, expected, error, 'automatic-recovery'\)/)
  assert.match(recovery, /await submitChatGPTDraft\(key, entry, entry\.affinity\.boundURL, \{ entry, wc, conversationUrl: entry\.affinity\.boundURL \}\)/)
  assert.match(recovery, /awaitingConversationAffinity: isChatGPTAffinityAwaitingSettlement\(entry\.affinity\)/)
  assert.match(recovery, /CHATGPT_AFFINITY_RECOVERY_GRACE_MS/)
})

test('a failed delivery continuation escalates once instead of looping behind a reset DOM failure counter', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const end = source.indexOf('\nasync function pollExpectedChatGPTDownloads()', start)
  const poll = source.slice(start, end)
  const continuation = poll.indexOf('const continuation = chatGPTDeliveryContinuationPrompt(')
  const escalation = poll.indexOf("escalateChatGPTContinuationFailure(key, expected, error, 'delivery-continuation')", continuation)
  const genericCatch = poll.indexOf('expected.domProbeFailures = Number(expected.domProbeFailures || 0) + 1', continuation)
  assert.notEqual(continuation, -1)
  assert.ok(escalation > continuation)
  assert.ok(genericCatch > escalation)
  assert.match(poll.slice(continuation, genericCatch), /catch \(error\) \{[\s\S]*escalateChatGPTContinuationFailure[\s\S]*return/)
})

test('pending bundles resume as durable AWAIT_RESPONSE tasks without allocating a hidden chat view', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const resumeStart = source.indexOf("ipcMain.handle('wharness:chatgpt:resume-expected-bundle'")
  const resumeEnd = source.indexOf("ipcMain.handle('wharness:chatgpt:continue-expected-bundle'", resumeStart)
  const resume = source.slice(resumeStart, resumeEnd)
  assert.ok(resumeStart >= 0, 'resume expected bundle IPC must exist')
  assert.match(resume, /const conversation = canonicalChatGPTConversationURL\(target\)/)
  assert.match(resume, /const workspaceChatId = durableWorkspaceChatID\(key, request\?\.workspaceChatId\)/)
  assert.match(resume, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort\(workspaceChatId, conversation, \{ remoteState: 'awaiting-response' \}\)/)
  assert.match(resume, /armExpectedChatGPTBundle\(key, requestId, 0, recoveryPrompt/)
  assert.match(resume, /recoveryEligibleAt = Date\.now\(\) \+ chatAgentInitialRequestWaitMs\(\)/)
  assert.match(resume, /expectedChatAgentPayload\(key, requestId, conversation/)
  assert.match(resume, /enqueueChatAgentTask\('AWAIT_RESPONSE'/)
  assert.match(resume, /dedupeKey: `await:\$\{requestId\}`/)
  assert.match(resume, /maxAttempts: 30/)
  assert.match(resume, /scheduled: true/)
  assert.doesNotMatch(resume, /ensureChatGPTView\(/)
  assert.doesNotMatch(resume, /setVisible\(false\)/)
  assert.doesNotMatch(resume, /pollExpectedChatGPTDownloadKey\(key\)/)
})

test('the Supervisor bound to a chat owns its expected-bundle observation whether visible or not, and Workers stand down from that lane', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  const ownershipStart = source.indexOf('function chatGPTSupervisorOwnsExpectedResponse(')
  const ownershipEnd = source.indexOf('\nfunction supervisorBindingHold', ownershipStart)
  const ownership = source.slice(ownershipStart, ownershipEnd)
  // Ownership must NOT depend on which Supervisor happens to be painted: a
  // hidden Supervisor stays on its conversation for the whole request, which is
  // what removes the navigation a Worker would otherwise make.
  assert.doesNotMatch(ownership, /chatGPTEntryIsActiveVisible/)
  assert.match(ownership, /expectedChatGPTBundles\.get\(key\)/)
  assert.match(ownership, /sameConversationURL\(currentURL, expectedURL\)/)
  // Manual transport and an in-flight external login cannot be supervised at
  // all, so claiming the lane there would silence it for every pool.
  assert.match(ownership, /entry\.externalAuthProvider \|\| chatgptTransportModes\.get\(key\) === 'manual'/)

  const lanesStart = source.indexOf('function chatSupervisorBoundLanes(')
  const lanes = source.slice(lanesStart, source.indexOf('\nfunction reconcileChatGPTThrottle', lanesStart))
  assert.match(lanes, /supervisorBindingHeld\(key, entry\)/)
  assert.match(lanes, /lanes\.add\(`h:\$\{key\}`\)/)
  assert.match(lanes, /lanes\.add\(`c:\$\{conversationID\}`\)/)

  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))
  const claimOptions = scheduler.slice(scheduler.indexOf('claimOptions: (worker)'), scheduler.indexOf('onIdle:'))
  assert.match(claimOptions, /const supervisorLanes = chatSupervisorBoundLanes\(\)/)
  assert.match(claimOptions, /releaseResidentLane\(entry\.slotId, residentLane\)/)
  assert.match(claimOptions, /excluded_lanes: \[\.\.\.new Set\(\[\.\.\.\(options\.excluded_lanes \|\| \[\]\), \.\.\.supervisorLanes\]\)\]\.slice\(0, 32\)/)

  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads()', pollStart)
  const poll = source.slice(pollStart, pollEnd)
  assert.match(poll, /if \(!entry \|\| !chatGPTSupervisorOwnsExpectedResponse\(key, expected\.requestId\)\) return/)
  // The poll is the only place that stamps structural progress, and the durable
  // supervision's stall bound reads that stamp.
  assert.match(poll, /if \(completion\?\.thinking === true \|\| completion\?\.complete === true\) expected\.progressAt = now/)
  assert.match(source, /setInterval\(\(\) => \{ void flushQueuedChatGPTComments\(\); void pollChatGPTVisibleActivity\(\); void pollExpectedChatGPTDownloads\(\); void reconcileChatAgentAutoScale\(\) \}, DOM_DOWNLOAD_POLL_MS\)/)
})

test('the two pools partition the durable queue: Supervisors take chat-bound work and Workers take everything smaller', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  const workerPool = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('), source.indexOf('chatAgentScheduler.start()'))
  assert.match(workerPool, /role: 'worker'/)
  assert.match(workerPool, /execute: executeChatAgentTask/)

  const supervisorPool = source.slice(source.indexOf('chatSupervisorScheduler = new ChatAgentSchedulerClient('), source.indexOf('chatSupervisorScheduler.start()'))
  assert.match(supervisorPool, /role: 'supervisor'/)
  assert.match(supervisorPool, /execute: executeChatSupervisorTask/)
  assert.match(supervisorPool, /workerCount: desiredChatAgentSupervisorSlots, maxWorkers: HARD_MAX_SUPERVISOR_SLOTS/)
  assert.match(supervisorPool, /agentID: chatSupervisorSlotID/)
  // A Supervisor mid-request may claim only its own chat's lane: claiming
  // another conversation is the cross-chat navigation this topology removes.
  assert.match(supervisorPool, /supervisorBindingHeld\(key, entry\)[\s\S]{0,160}fallback_mode: 'resident_only'/)
  assert.match(supervisorPool, /excluded_lanes: \[\.\.\.taken\]\.slice\(0, 32\)/)

  const executeStart = source.indexOf('async function executeChatSupervisorTask(')
  const execute = source.slice(executeStart, source.indexOf('\nasync function executeChatAgentTask(', executeStart))
  for (const type of ['AWAIT_RESPONSE', 'BOT_WRITE', 'RECOVERY_WRITE', 'ORCHESTRATOR_PLAN']) {
    assert.match(execute, new RegExp(`case '${type}'`), `the Supervisor pool must run ${type}`)
  }
  for (const type of ['RENAME_CHAT', 'ORGANIZE_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_BUNDLE', 'TRANSLATE_MARKDOWN', 'TODO_CLASSIFY', 'TITLE_DISCOVER']) {
    assert.doesNotMatch(execute, new RegExp(`case '${type}'`), `${type} is small Worker work and must never reach a Supervisor`)
  }
  // Navigation is the exception, not the rule: the bound renderer is normally
  // already on the conversation, and a navigation that does happen is paced by
  // the same process-wide provider gate every Worker action uses.
  assert.match(execute, /if \(conversationURL && !sameConversationURL\(current, conversationURL\)\) \{\n\s+await paceChatGPTWorkerNavigation\(\)/)
  // Every slot still finishing a request is a free wait, never a charged attempt.
  assert.match(execute, /status: 'waiting', delayMs: CHAT_SUPERVISOR_SLOT_WAIT_MS, observation: true/)
})

test('a Supervisor releases its chat only after the request settled and another chat needs the slot', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

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
  assert.match(evict, /const excess = chatgptViews\.size - desiredChatAgentSupervisorSlots/)
  assert.match(evict, /!supervisorBindingHeld\(key, entry\) && !chatGPTEntryIsActiveVisible\(key, entry\)/)
  assert.match(evict, /if \(released >= excess\) break/)
  assert.doesNotMatch(source, /setInterval\([^)]*evictIdleChatGPTViews/)
})

test('background ChatGPT views disable renderer throttling and escalate structural or exhausted transport failures to human attention', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')
  const createStart = source.indexOf('function createChatGPTView(cacheKey, windowState)')
  const createEnd = source.indexOf('\nfunction ensureChatGPTView', createStart)
  const create = source.slice(createStart, createEnd)
  assert.match(create, /backgroundThrottling: false/)
  assert.match(source, /chatGPTHumanActionScript\(\)/)
  assert.match(source, /humanAction: entry\?\.humanAction\?\.active/)
  assert.match(source, /new Notification\(\{ title: 'Ação necessária no ChatGPT'/)
  assert.match(source, /window\.flashFrame\(true\)/)
  assert.match(source, /CHATGPT_RATE_LIMIT_BACKOFF_MS = 60_000/)
  assert.match(source, /conversationRequests: new Map\(\)/)
  assert.match(source, /conversationTransportGeneration: 0/)
  assert.match(source, /recordChatGPTConversationTransport\(entry\.conversationRequests, requestKey, entry\.conversationTransportGeneration, phase, now\)/)
  assert.match(source, /did-start-navigation[^\n]+advanceChatGPTConversationTransportGeneration\(entry\)/)
  assert.match(source, /transportActive: transport\.state === 'active'/)
  assert.match(source, /bundle DOM probe failed/)
  assert.match(source, /page load remained pending for more than 30 seconds/)
  assert.match(source, /\['surface', 'authentication', 'access'\]\.includes\(entry\.humanAction\.kind\)/)
  assert.match(preload, /wharness:chatgpt:human-action/)
})

test('idle backgrounded ChatGPT views may re-enable normal throttling, but never the active view or one Wharnex still needs to supervise', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  const needsStart = source.indexOf('function chatGPTEntryNeedsSupervision(key, entry)')
  const needsEnd = source.indexOf('\nfunction chatGPTEntryIsActiveVisible', needsStart)
  const needs = source.slice(needsStart, needsEnd)
  assert.match(needs, /entry\.loading/)
  assert.match(needs, /entry\.humanAction\?\.active/)
  assert.match(needs, /entry\.accountOperationActive/)
  assert.match(needs, /entry\.transportPreparationCount > 0/)
  assert.match(needs, /entry\.conversationRequests\.size > 0/)
  assert.match(needs, /pendingChatGPTComments\.has\(key\)/)
  // An armed expectation keeps its Supervisor at full speed whether or not that
  // slot is the painted one: a hidden Supervisor bound to its chat is the normal
  // case, and it is the surface the response will be collected from.
  assert.match(needs, /\|\| expectedChatGPTBundles\.has\(key\)\)/)
  assert.doesNotMatch(needs, /expectedChatGPTBundles\.has\(key\) && chatGPTEntryIsActiveVisible/)

  const reconcileStart = source.indexOf('function reconcileChatGPTThrottle(key, entry)')
  const reconcileEnd = source.indexOf('\nfunction sendToWindowState', reconcileStart)
  const reconcile = source.slice(reconcileStart, reconcileEnd)
  assert.match(reconcile, /chatGPTEntryIsActiveVisible\(key, entry\) \|\| chatGPTEntryNeedsSupervision\(key, entry\)/)
  assert.match(reconcile, /entry\.view\.webContents\.setBackgroundThrottling\(!fullSpeed\)/)

  // Reconciled on every visibility transition (both the outgoing and the
  // incoming view) and on the existing bounded poller, never left to drift
  // until something else happens to touch that chat.
  const activateStart = source.indexOf('function activateChatGPTView(cacheKey, bounds, windowState)')
  const activateEnd = source.indexOf('\nfunction wait(', activateStart)
  const activate = source.slice(activateStart, activateEnd)
  assert.match(activate, /reconcileChatGPTThrottle\(previousKey, previous\)/)
  assert.match(activate, /reconcileChatGPTThrottle\(key, entry\)/)
  const hideStart = source.indexOf("ipcMain.handle('wharness:chatgpt:hide',")
  const hideEnd = source.indexOf("ipcMain.handle('wharness:chatgpt:set-bounds',", hideStart)
  const hideHandler = source.slice(hideStart, hideEnd)
  assert.match(hideHandler, /reconcileChatGPTThrottle\(key, entry\)/)
  const pollStart = source.indexOf('async function pollChatGPTVisibleActivity()')
  const pollLoopStart = source.indexOf('for (const [key, entry] of chatgptViews)', pollStart)
  const pollLoop = source.slice(pollLoopStart, pollLoopStart + 200)
  assert.match(pollLoop, /reconcileChatGPTThrottle\(key, entry\)/)
})

test('Supervisor transport stays unthrottled while durable resume bypasses the visible surface', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const helperStart = source.indexOf('async function withChatGPTTransportPreparation(')
  const helperEnd = source.indexOf('\nfunction sendToWindowState', helperStart)
  const helper = source.slice(helperStart, helperEnd)
  assert.match(helper, /transportPreparationCount[\s\S]*reconcileChatGPTThrottle[\s\S]*try[\s\S]*await operation\(\)[\s\S]*finally[\s\S]*transportPreparationCount[\s\S]*reconcileChatGPTThrottle/)
  for (const channel of ['submit-prompt', 'prepare-prompt', 'retry-prepared-prompt', 'attach-context', 'attach-prompt', 'submit-prepared']) {
    const start = source.indexOf(`ipcMain.handle('wharness:chatgpt:${channel}'`)
    const end = source.indexOf('\n  })', start)
    assert.match(source.slice(start, end), /withChatGPTSupervisorTransport/)
  }
  assert.match(source, /withChatGPTSupervisorTransport[\s\S]*withChatGPTTransportPreparation/)
  const resumeStart = source.indexOf("ipcMain.handle('wharness:chatgpt:resume-expected-bundle'")
  const resumeEnd = source.indexOf("ipcMain.handle('wharness:chatgpt:continue-expected-bundle'", resumeStart)
  const resume = source.slice(resumeStart, resumeEnd)
  assert.match(resume, /enqueueChatAgentTask\('AWAIT_RESPONSE'/)
  assert.doesNotMatch(resume, /withChatGPTTransportPreparation/)
  assert.match(source.slice(source.indexOf('async function flushQueuedChatGPTComments()'), source.indexOf('\nasync function publishRemoteChannelComment')), /withChatGPTTransportPreparation/)
})

test('request cancellation clears only matching Desktop supervision state and a validated bundle clears stale human attention', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const cancelStart = source.indexOf('function cancelChatGPTRequestState(')
  const cancelEnd = source.indexOf('\nasync function chatGPTAssistantTurnCount', cancelStart)
  const cancel = source.slice(cancelStart, cancelEnd)
  assert.match(cancel, /expected\?\.requestId === id/)
  assert.match(cancel, /retryable\?\.request\?\.requestId/)
  assert.match(cancel, /prepared\?\.requestId/)
  assert.match(cancel, /comment\?\.requestId/)
  assert.match(cancel, /clearChatGPTHumanAction/)
  assert.match(cancel, /chatAgentScheduler\.cancelLineage\(id\)/)
  assert.match(cancel, /try\s*\{[\s\S]*await refreshChatAgentRuntimeState\(\)[\s\S]*\}\s*catch/)
  assert.match(source, /wharness:chatgpt:cancel-request/)
  const ackStart = source.indexOf('async function acknowledgeChatGPTBundle(')
  const ackEnd = source.indexOf('\nfunction chatGPTPartitionPath', ackStart)
  const ack = source.slice(ackStart, ackEnd)
  assert.match(ack, /markChatGPTBundleRequestDelivered\(id\)/)
  assert.match(ack, /cancelChatGPTRequestState\(key, id\)/)
  assert.match(source, /wharness:chatgpt:ack-bundle/)
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
  assert.match(comments, /await submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target\)/)
  assert.match(comments, /armExpectedChatGPTBundle\(key, pending\.requestId, assistantBaseline, '', \[\], '', pending\.sessionId, expectedFilename, requestMetadata\)/)

  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function exportBrowserSession', pollStart)
  const polling = source.slice(pollStart, pollEnd)
  assert.match(polling, /hasPendingChatGPTComments\(key\)\) return/)
  assert.match(polling, /chatGPTResponseCompletionScript\(expected\.assistantBaseline\)/)
  assert.match(polling, /chatGPTDeliveryContinuationPrompt/)
  assert.match(polling, /MAX_BUNDLE_CONTINUATIONS/)
})

test('manual pending-request continuation classifies active versus stale transport and stays request scoped', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("ipcMain.handle('wharness:chatgpt:continue-expected-bundle'")
  const end = source.indexOf("ipcMain.handle('wharness:chatgpt:pick-bundle'", start)
  const handler = source.slice(start, end)
  assert.ok(start >= 0)
  assert.match(handler, /reason: 'not_supervised'/)
  assert.match(handler, /entry\.loading \|\| wc\.isLoading\(\)/)
  assert.match(handler, /await waitForChatGPTSurfaceReady\(key, entry\)/)
  assert.match(handler, /classifyChatGPTConversationTransport\(entry\.conversationRequests/)
  assert.match(handler, /reason: 'transport_active'/)
  assert.match(handler, /transport\.state === 'stale'/)
  assert.match(handler, /const staleTransport = transport\.state === 'stale' \|\| entry\.staleConversationRequestIds\.size > 0/ )
  assert.match(handler, /reason: staleTransport \? 'transport_stale' : 'processing_ambiguous'/)
  assert.match(handler, /request\?\.force/)
  assert.match(handler, /manualContinuationInFlight/)
  assert.match(handler, /reason: 'continuation_in_flight'/)
  assert.match(handler, /chatGPTStalledRecoveryPrompt\(requestId, expected\.filename/)
  assert.match(handler, /escalateChatGPTContinuationFailure\(key, expected, error, 'manual-continuation'\)/)
  assert.match(handler, /reason: 'continuation_failed'/)
  assert.match(handler, /await submitChatGPTDraft\(key, entry, affinityURL, targeted\)/)
  assert.match(handler, /reason: 'submitted'/)
})

test('processing detection uses hysteresis and escalates a stale ambiguous control without interrupting it', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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


test('two Supervisor slots double-buffer renderer IPC while bounded workers stay outside chat view ownership', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')
  const ensureStart = source.indexOf('function ensureChatGPTView(cacheKey, windowState)')
  const ensureEnd = source.indexOf('\nfunction evictIdleChatGPTViews', ensureStart)
  const ensure = source.slice(ensureStart, ensureEnd)
  const workerStart = source.indexOf('function reconcileChatGPTWorkerPool(windowState)')
  const workerEnd = source.indexOf('\nfunction assignChatGPTWorker', workerStart)
  const workers = source.slice(workerStart, workerEnd)
  assert.match(source, /const chatGPTWorkerEntries = \[\]/)
  assert.match(source, /let desiredChatAgentSupervisorSlots = DEFAULT_SUPERVISOR_SLOTS/)
  assert.match(source, /let desiredChatAgentWorkerSlots = DEFAULT_WORKER_SLOTS/)
  assert.match(ensure, /entry\.role = 'supervisor'/)
  assert.match(ensure, /entry\.slotId = supervisorSlotID\(\)/)
  assert.match(ensure, /chatgptViews\.size >= desiredChatAgentSupervisorSlots/)
  assert.match(ensure, /const reusable = reusableSupervisor\(key, resolved\)/)
  assert.match(ensure, /retireChatGPTSupervisorSurface\(reusable\[0\]\)/)
  assert.match(workers, /index < desiredChatAgentWorkerSlots/)
  assert.match(workers, /createChatGPTWorkerView\(`worker-\$\{index \+ 1\}`/)
  assert.match(workers, /while \(chatGPTWorkerEntries\.length > desiredChatAgentWorkerSlots\)/)
  assert.match(workers, /if \(candidate\?\.interactionWindowId \|\| runtime\?\.task \|\| runtime\?\.active !== false\) break/)
  assert.match(workers, /reconcileChatGPTWorkerPool\(windowState\)/)
  assert.match(source, /function workerEntryForIndex\(worker\)/)
  assert.match(source, /entry\.role !== 'worker'/)

  assert.match(preload, /hide: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /state: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /reload: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /paste: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(preload, /release: \(cacheKey\).*\{ cacheKey \}/)
  assert.match(source, /wharness:chatgpt:release/)
  assert.match(source, /const deliveryCacheKey = bundleCandidate\.unrouted \? '' : sourceCacheKey/)
  assert.match(source, /publishBundleDownload\(\{ cacheKey: deliveryCacheKey, filename/)
  assert.match(source, /publishPlanDownload\(\{ cacheKey: sourceCacheKey, filename/)
})

test('agent browser snapshots park hidden workers into a real layout viewport', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function chatAgentBrowserSnapshot(agentID)')
  const end = source.indexOf('\nfunction retireChatGPTSupervisorSurface', start)
  assert.notEqual(start, -1)
  const snapshot = source.slice(start, end)
  assert.match(snapshot, /ensureChatGPTLayoutViewport\(layoutKey, entry\)/)
  assert.match(snapshot, /await wc\.capturePage\(\)/)
  assert.match(snapshot, /entry\.ownerKey \|\| \(entry\.role === 'supervisor' \? supervisorKey/)
})

test('agent runtime reconciles Worker occupancy from durable lease owners', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const refreshStart = source.indexOf('async function refreshChatAgentRuntimeState()')
  const refreshEnd = source.indexOf('\nfunction publicAgentBrowser', refreshStart)
  const refresh = source.slice(refreshStart, refreshEnd)
  const reconcileStart = source.indexOf('function reconcileChatAgentWorkerTasks(tasks = [])')
  const reconcileEnd = source.indexOf('\nfunction publicChatAgentTask', reconcileStart)
  const reconcile = source.slice(reconcileStart, reconcileEnd)
  assert.match(refresh, /list\(\{ status: 'LEASED', limit: 50 \}\)/)
  assert.match(refresh, /list\(\{ status: 'RUNNING', limit: 50 \}\)/)
  assert.match(refresh, /reconcileChatAgentWorkerTasks/)
  assert.match(reconcile, /lease_owner/)
  assert.match(reconcile, /\['LEASED', 'RUNNING'\]/)
  assert.match(source, /status: runtime\.task \? \(String\(runtime\.task\.status/)
  assert.match(source, /: 'claimed'/)
})

test('agent runtime browser projection fails closed while WebContents is retiring', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function unavailableAgentBrowser()')
  const end = source.indexOf('\nfunction chatAgentRuntimeMemory', start)
  assert.notEqual(start, -1)
  const projection = source.slice(start, end)

  assert.match(projection, /if \(!wc \|\| wc\.isDestroyed\(\)\) return unavailableAgentBrowser\(\)/)
  assert.match(projection, /const currentURL = wc\.getURL\(\) \|\| ''/)
  assert.match(projection, /title: wc\.getTitle\(\) \|\| ''/)
  assert.match(projection, /catch \{[\s\S]*return unavailableAgentBrowser\(\)[\s\S]*\}/)
})

test('autonomous workers pace chat switches, wait for page settle, and pause on HTTP 429', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const paceStart = source.indexOf('async function paceChatGPTWorkerRequest(')
  const paceEnd = source.indexOf('\nasync function pasteChatGPTFile', paceStart)
  const pacing = source.slice(paceStart, paceEnd)
  const executeStart = source.indexOf('async function executeChatAgentTask(task, { worker, owner })')
  const executeEnd = source.indexOf('\n\nfunction chatGPTCommentFingerprint', executeStart)
  const execute = source.slice(executeStart, executeEnd)
  const statusStart = source.indexOf('function noteChatGPTHTTPStatus(details)')
  const statusEnd = source.indexOf('\nfunction settleChatGPTAffinityAfterSubmit', statusStart)
  const httpStatus = source.slice(statusStart, statusEnd)

  assert.match(source, /const CHATGPT_WORKER_NAVIGATION_GAP_MS = CHAT_AGENT_NAVIGATION_GAP_MS/)
  assert.match(pacing, /await wait\(remaining\)/)
  assert.match(pacing, /await loadOwnedChatGPTURL/)
  assert.match(pacing, /await waitForChatGPTSurfaceReady/)
  assert.match(execute, /initialRateLimitDelay = chatAgentRateLimitDelayMs\(\)/)
  assert.match(execute, /loadAndSettleChatGPTWorkerConversation/)
  assert.match(execute, /status: 'waiting', delayMs: rateLimitDelay/)
  const applyStart = source.indexOf('function applyChatGPTRateLimit(')
  const apply = source.slice(applyStart, source.indexOf('\nfunction noteChatGPTRateLimitGate(', applyStart))

  assert.match(httpStatus, /status === 429/)
  // Widened from the main frame plus four conversation endpoints: a refusal on
  // any trusted backend endpoint is evidence about the account.
  assert.match(httpStatus, /details\?\.resourceType === 'mainFrame' \|\| isChatGPTBackendAPIURL\(details\?\.url\)/)
  assert.match(httpStatus, /applyChatGPTRateLimit\(key/)
  assert.match(apply, /chatGPTRateLimitUntil = Math\.max\(chatGPTRateLimitUntil, localUntil\)/)
  assert.match(apply, /recordRateLimit\(source, classification\.kind\)/)
  // The durable pause the backend persisted still wins over the local mirror.
  assert.match(apply, /persistedUntil/)
})

test('Worker live interaction uses bounded trusted IPC and fail-closed lifecycle cleanup', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')
  const showStart = source.indexOf('function showChatAgentInteraction(agentID, rawBounds, windowState)')
  const showEnd = source.indexOf('\nfunction setChatAgentInteractionBounds', showStart)
  const show = source.slice(showStart, showEnd)
  assert.match(show, /workerEntryForAgentID\(agentID\)/)
  assert.match(show, /normalizeBounds\(rawBounds, windowState\?\.window\?\.getContentBounds\?\.\(\)\)/)
  assert.match(show, /entry\.view\.setVisible\(true\)/)
  assert.match(source, /hideChatAgentInteractionsForWindow\(state\)/)
  assert.match(source, /activeAgentInteractionId/)
  assert.match(source, /wharness:agents:interaction-open/)
  assert.match(source, /wharness:agents:interaction-bounds/)
  assert.match(source, /wharness:agents:interaction-close/)
  assert.match(source, /wharness:agents:open-devtools[\s\S]*workerEntryForAgentID\(request\?\.agentId\)[\s\S]*openDevTools\(\{ mode: 'detach', activate: true \}\)/)
  assert.match(source, /wharness:chatgpt:open-devtools[\s\S]*chatgptViews\.get\(key\)[\s\S]*ownerWindowId !== windowState\.id[\s\S]*requireOwnedChatGPTEntry\(key, entry\)[\s\S]*openDevTools\(\{ mode: 'detach', activate: true \}\)/)
  assert.match(preload, /openInteraction:/)
  assert.match(preload, /setInteractionBounds:/)
  assert.match(preload, /closeInteraction:/)
  assert.match(preload, /wharness:agents:open-devtools/)
  assert.match(preload, /wharness:chatgpt:open-devtools/)
})

test('Agents panel suspension uses the durable provider pause with optional deadline', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')
  const start = source.indexOf("ipcMain.handle('wharness:agents:pause-provider'")
  const end = source.indexOf("ipcMain.handle('wharness:agents:resume-provider'", start)
  const handler = source.slice(start, end)

  assert.ok(start >= 0, 'pause-provider IPC handler must exist')
  assert.match(handler, /Date\.parse\(rawUntil\)/)
  assert.match(handler, /setProviderPause\(true, \{ pausedUntil, reason \}\)/)
  assert.match(handler, /deadline <= Date\.now\(\)/)
  assert.match(preload, /pauseProvider: \(pausedUntil\) => invoke\('wharness:agents:pause-provider'/)
})

test('switching chats reuses a released Supervisor slot and preserves visible intent when recycling', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const ensureStart = source.indexOf('function ensureChatGPTView(cacheKey, windowState)')
  const ensureEnd = source.indexOf('\nfunction evictIdleChatGPTViews', ensureStart)
  const ensure = source.slice(ensureStart, ensureEnd)

  assert.match(ensure, /chatgptViews\.size >= desiredChatAgentSupervisorSlots/)
  assert.match(ensure, /const reusable = reusableSupervisor\(key, resolved\)/)
  // Eligibility is the whole binding hold, not just an open transport: a chat
  // awaiting its response bundle must not lose its renderer to a chat switch.
  assert.match(source, /function reusableSupervisor[\s\S]*!supervisorBindingHeld\(candidateKey, entry\)/)
  assert.match(ensure, /const preserveVisibleIntent = resolved\?\.chatgptVisible === true/)
  assert.match(ensure, /retireChatGPTSupervisorSurface\(reusable\[0\]\)[\s\S]*if \(preserveVisibleIntent && resolved\) resolved\.chatgptVisible = true/)
})

test('a busy Supervisor hides its old surface and publishes the deferred target state', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const deferStart = source.indexOf('function setDeferredSupervisorNavigation(')
  const deferEnd = source.indexOf('\nasync function applyDeferredSupervisorNavigation', deferStart)
  const deferred = source.slice(deferStart, deferEnd)
  const navigateStart = source.indexOf("ipcMain.handle('wharness:chatgpt:navigate'")
  const navigateEnd = source.indexOf("ipcMain.handle('wharness:chatgpt:confirm-affinity'", navigateStart)
  const navigate = source.slice(navigateStart, navigateEnd)

  assert.match(source, /const surfaceDeferred = Boolean/)
  assert.match(source, /function differentSupervisorTransport[\s\S]*candidateKey !== key[\s\S]*transportPreparationCount/)
  assert.match(deferred, /const activeTransport = differentSupervisorTransport\(key\)/)
  assert.match(deferred, /if \(activeTransport\)[\s\S]*setDeferredSupervisorNavigation\(key, windowState, request, current\)[\s\S]*return true/)
  assert.match(deferred, /current\.view\.setVisible\(false\)/)
  assert.match(deferred, /sendToWindowState\(windowState, 'wharness:chatgpt:state', currentChatGPTState\(key, windowState\)\)/)
  assert.match(navigate, /return currentChatGPTState\(key, windowState\)/)
  assert.doesNotMatch(navigate, /return currentChatGPTState\(supervisorKey\(\), windowState\)/)
})

test('deferred Supervisor navigation retries until its gate is actually clear', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const scheduleStart = source.indexOf('function scheduleDeferredSupervisorNavigation()')
  const scheduleEnd = source.indexOf('\nfunction setDeferredSupervisorNavigation', scheduleStart)
  const schedule = source.slice(scheduleStart, scheduleEnd)
  const applyStart = source.indexOf('async function applyDeferredSupervisorNavigation()')
  const applyEnd = source.indexOf('\nfunction wait(ms)', applyStart)
  const apply = source.slice(applyStart, applyEnd)

  assert.match(schedule, /setTimeout\([\s\S]*applyDeferredSupervisorNavigation\(\)/)
  assert.match(apply, /differentSupervisorTransport\(pending\.key\)[\s\S]*scheduleDeferredSupervisorNavigation\(\)[\s\S]*return/)
  assert.match(apply, /!chatgptViews\.has\(pending\.key\) && chatgptViews\.size >= desiredChatAgentSupervisorSlots/)
  assert.match(apply, /!reusableSupervisor\(pending\.key, state\)[\s\S]*scheduleDeferredSupervisorNavigation\(\)[\s\S]*return/)
  assert.match(apply, /clearDeferredSupervisorNavigation\(\)[\s\S]*activateChatGPTView\(pending\.key/)
})

test('direct Supervisor writes serialize across chats and preserve the selected surface', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const helperStart = source.indexOf('async function withChatGPTSupervisorTransport(')
  const helperEnd = source.indexOf('\nfunction sendToWindowState', helperStart)
  const helper = source.slice(helperStart, helperEnd)

  assert.match(source, /let chatGPTSupervisorTransportTail = Promise\.resolve\(\)/)
  assert.match(helper, /await waitForDifferentSupervisorTransport\(key\)/)
  assert.match(helper, /preserveVisibleSupervisorForTransport\(key, windowState\)/)
  assert.match(helper, /withChatGPTTransportPreparation\(key, entry, requestId/)
  for (const channel of ['submit-prompt', 'prepare-prompt', 'retry-prepared-prompt', 'attach-context', 'attach-prompt', 'submit-prepared']) {
    const start = source.indexOf(`ipcMain.handle('wharness:chatgpt:${channel}'`)
    const end = source.indexOf('\n  })', start)
    assert.match(source.slice(start, end), /withChatGPTSupervisorTransport/)
  }
})

test('auto submit persists binding and delegates response supervision to workers', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const end = source.indexOf('\nasync function retryPersistedChatGPTPrompt', start)
  const prepare = source.slice(start, end)

  assert.match(prepare, /const workspaceChatId = durableWorkspaceChatID\(key, request\?\.workspaceChatId\)/)
  assert.match(prepare, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort\(workspaceChatId, conversationUrl, \{ remoteState: 'awaiting-response' \}\)/)
  assert.match(prepare, /await enqueueChatAgentFollowups\(key, requestId, conversationUrl/)
  assert.doesNotMatch(prepare, /WHX CONVERSATION IDENTITY/)
  assert.doesNotMatch(prepare, /organizeChatGPTConversation\(/)
  assert.doesNotMatch(prepare, /publishChatGPTAccountAction\(key, 'organize'/)

  const followups = source.slice(source.indexOf('async function enqueueChatAgentFollowups('), source.indexOf('\nfunction hydrateExpectedChatAgentBundle', source.indexOf('async function enqueueChatAgentFollowups(')))
  assert.match(followups, /enqueueChatAgentTask\('AWAIT_RESPONSE'/)
  assert.doesNotMatch(followups, /TITLE_DISCOVER/)
})

test('legacy title tasks cannot create temporary ChatGPT conversations', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const discoverStart = source.indexOf('async function executeChatAgentTitleDiscover(')
  const discoverEnd = source.indexOf('\nasync function executeChatAgentTempTitle', discoverStart)
  const discover = source.slice(discoverStart, discoverEnd)
  assert.match(discover, /Compatibility sink/)
  assert.doesNotMatch(discover, /suggestChatGPTConversationTitle|TITLE_GENERATE_TEMP|ORGANIZE_CHAT/)

  const tempStart = source.indexOf('async function executeChatAgentTempTitle(')
  const tempEnd = source.indexOf('\nasync function executeChatAgentTitleAwait', tempStart)
  const temp = source.slice(tempStart, tempEnd)
  assert.match(temp, /Compatibility sink/)
  assert.doesNotMatch(temp, /targetChatGPTComposer|submitChatGPTDraft|TITLE_AWAIT/)
})

test('confirmed ChatGPT submits treat remote-state and supervision failures as post-submit failures instead of resending', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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

test('bundle download failures remain correlated to a strict late filename instead of the newer active request', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function publishBundleDownloadError')
  const end = source.indexOf('\nfunction registerChatGPTPlanDownloads', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const publish = source.slice(start, end)
  assert.match(publish, /wharnessBundleRequestIdFromFilename\(filename\) \|\| expectedChatGPTBundles\.get\(cacheKey\)\?\.requestId/)
})

test('ChatGPT request archive upload uses the dedicated file input instead of clipboard paste', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function pasteChatGPTFile(entry, filePath, index, count)')
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
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function pasteChatGPTFile(entry, filePath, index, count)')
  const end = source.indexOf('\nasync function submitChatGPTDraft', start)
  const upload = source.slice(start, end)
  const beforeAttemptStart = upload.indexOf('beforeAttempt: async () => {')
  const beforeAttemptEnd = upload.indexOf('beginUpload:', beforeAttemptStart)
  const beforeAttempt = upload.slice(beforeAttemptStart, beforeAttemptEnd)
  assert.match(beforeAttempt, /await paceChatGPTWorkerSubmission\(\)/)
})

test('task comments are sent as a single protocol ZIP containing the guidance and attachments', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const materializeStart = source.indexOf('async function materializeProtocolChatInput')
  const materializeEnd = source.indexOf('\nasync function fillBundledChatGPTComposer', materializeStart)
  const materialize = source.slice(materializeStart, materializeEnd)
  assert.notEqual(materializeStart, -1)
  assert.match(materialize, /const context = await fetchContextZip\(sessionId\)/)
  assert.match(materialize, /writeChatInputArchive\(archivePath, \{ requestId, requestMetadata, prompt: promptText, context, knowledge, gitContext, continuation, attachments: decoded, liveTunnels \}\)/)
  // The attempt ledger and divergence report must ride in the same single
  // protocol ZIP; fetching them separately at send time would let a comment
  // reach ChatGPT without the evidence the prompt says is attached.
  assert.match(materialize, /const gitContext = await fetchRequestGitContext\(sessionId\)/)
  assert.match(materialize, /const continuation = await fetchRequestContinuation\(sessionId, requestId\)/)

  const flushStart = source.indexOf('async function flushQueuedChatGPTComments')
  const flushEnd = source.indexOf('\nasync function publishRemoteChannelComment', flushStart)
  const flush = source.slice(flushStart, flushEnd)
  assert.notEqual(flushStart, -1)
  assert.match(flush, /fillBundledChatGPTComposer\(key, target\.entry, pending\.sessionId, pending\.requestId, commentPrompt,[^\n]+pending\.attachments, liveTunnels, requestMetadata\)/)
  assert.doesNotMatch(flush, /chatGPTFillComposerScript\(pending\.text\)/)
})

test('submitChatGPTDraft retries a dispatched-but-unconfirmed submit instead of returning a silently ignorable failure', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("async function submitChatGPTDraft(key, entryOverride = undefined, expectedURL = '', preparedTarget = undefined, { requireReasoningEffort = true } = {})")
  const end = source.indexOf('\nasync function preparePromptForChatGPT', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = source.slice(start, end)
  assert.match(body, /submitWithRetry\(\{/)
  assert.match(body, /beginSubmission: \(\) => chatGPTSubmissions\.expect\(wc\.id\)/)
  // A retry loop that never re-verifies composer readiness between attempts
  // is not really a retry; and an omitted beforeAttempt previously crashed
  // every automatic submit with "beforeAttempt is not a function" because
  // submitWithRetry had no default, silently turning a real ChatGPT send
  // failure (e.g. a repair prompt) into a stale expected-bundle wait that
  // later got "resolved" with an unrelated generic continuation nudge.
  assert.match(body, /beforeAttempt: async \(attempt\) => \{/)
  assert.match(body, /const expectedConversation = canonicalChatGPTConversationURL\(expectedURL\)/)
  assert.match(body, /assertExpectedConversation\(\)/)
  assert.match(body, /sameConversationURL\(wc\.getURL\(\), expectedConversation\)/)
  // The old implementation swallowed a failed submit into `{ accepted: false }`
  // instead of throwing — every caller must see a real error now.
  assert.doesNotMatch(body, /return \{ accepted: false/)
})

test('every ChatGPT submit verifies the requested reasoning effort before starting its POST observation', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("async function submitChatGPTDraft(key, entryOverride = undefined, expectedURL = '', preparedTarget = undefined, { requireReasoningEffort = true } = {})")
  const end = source.indexOf('\nasync function preparePromptForChatGPT', start)
  const body = source.slice(start, end)
  const ensure = body.indexOf('await ensureChatGPTReasoningEffort({')
  const observe = body.indexOf("executeChatGPTDOMScript(key, target.entry, 'reasoning-effort-state'")
  const cycle = body.indexOf('dispatchChatGPTEffortCycle(owned.wc)')
  const submit = body.indexOf('submitWithRetry({')
  assert.ok(ensure >= 0 && observe > ensure && cycle > observe && submit > cycle)
  assert.match(body, /normalizeChatGPTReasoningEffort\(target\.reasoningEffort \|\| target\.entry\.reasoningEffort \|\| 'high'\)/)
})

// Live testing against the real ChatGPT account showed the effort-cycle
// keyboard shortcut can stop registering entirely (observed stuck on "high"
// through every bounded cycle), and that this is unrelated to anything the
// submission itself is doing. `submitChatGPTDraft`'s default behavior must
// stay fail-closed for correctness-sensitive planning exchanges, so this
// bypass has to be explicit per caller, not a change to the default.
test('an unreachable reasoning effort still blocks submission unless a caller explicitly opts out', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("async function submitChatGPTDraft(key, entryOverride = undefined, expectedURL = '', preparedTarget = undefined, { requireReasoningEffort = true } = {})")
  const end = source.indexOf('\nasync function preparePromptForChatGPT', start)
  assert.notEqual(start, -1)
  const body = source.slice(start, end)
  assert.match(body, /if \(requireReasoningEffort\) throw error/)

  // Only the two background bundle-only workers (TODO classification and
  // markdown translation) may opt out; every other caller keeps the default.
  const classifyStart = source.indexOf('async function executeChatAgentTodoClassification(task, entry, key, payload)')
  const classifyEnd = source.indexOf('\nasync function chatAgentLifecycleRetry', classifyStart)
  assert.match(source.slice(classifyStart, classifyEnd), /submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target, \{ requireReasoningEffort: false \}\)/)

  const translateStart = source.indexOf('async function executeChatAgentMarkdownTranslation(task, entry, key, payload)')
  const translateEnd = source.indexOf('\nasync function executeChatAgentTodoClassification', translateStart)
  assert.match(source.slice(translateStart, translateEnd), /submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target, \{ requireReasoningEffort: false \}\)/)

  const botWriteCount = (body.match(/requireReasoningEffort: false/g) || []).length
  assert.equal(botWriteCount, 0, 'submitChatGPTDraft itself must keep failing closed by default')
})

test('expected bundle supervision is armed only around submissions that can leave stale state', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')
  const prepareEnd = source.indexOf('\nasync function retryPersistedChatGPTPrompt', prepareStart)
  assert.notEqual(prepareStart, -1)
  assert.notEqual(prepareEnd, -1)
  const prepare = source.slice(prepareStart, prepareEnd)
  const submitCount = (prepare.match(/await submitChatGPTDraft\(key, target\.entry, target\.conversationUrl, target\)/g) || []).length
  const disarmCount = (prepare.match(/disarmExpectedChatGPTBundle\(key, requestId\)/g) || []).length
  assert.equal(submitCount, 1, 'the mandatory ZIP autoSubmit path calls submitChatGPTDraft once')
  assert.equal(disarmCount, 1, 'a failed autoSubmit disarms the bundle armed before dispatch')

  const preparedStart = source.indexOf('async function submitPreparedChatGPTDraft(')
  const preparedEnd = source.indexOf('\nasync function submitPromptToChatGPT', preparedStart)
  const prepared = source.slice(preparedStart, preparedEnd)
  const preparedSubmit = prepared.indexOf('await submitChatGPTDraft(key, entry, prepared.conversationUrl || entry.affinity.boundURL)')
  const preparedArm = prepared.indexOf('armExpectedChatGPTBundle(key, prepared.requestId')
  assert.ok(preparedSubmit >= 0 && preparedArm > preparedSubmit, 'manual prepared submit arms supervision only after submit confirmation')
  assert.doesNotMatch(prepared, /disarmExpectedChatGPTBundle\(key, prepared\.requestId\)/)

  const repairStart = source.indexOf('async function submitPromptToChatGPT')
  const repairEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', repairStart)
  const repair = source.slice(repairStart, repairEnd)
  const repairSubmit = repair.indexOf('await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)')
  const repairArm = repair.indexOf('armExpectedChatGPTBundle(key, requestId')
  assert.ok(repairSubmit >= 0 && repairArm > repairSubmit, 'repair submission arms supervision only after submit confirmation')
})

test('pollChatGPTVisibleActivity skips DOM probing while the view is still navigating, mirroring pollExpectedChatGPTDownloadKey', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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

test('Manual chat transport mode disarms bundle polling, skips activity probing, and lets downloads pass through uncontrolled', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  const pollDownloadStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollDownloadEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', pollDownloadStart)
  assert.notEqual(pollDownloadStart, -1)
  const pollDownload = source.slice(pollDownloadStart, pollDownloadEnd)
  const transportGuard = pollDownload.indexOf("chatgptTransportModes.get(key) === 'manual'")
  const ttlCheck = pollDownload.indexOf('EXPECTED_BUNDLE_TTL_MS')
  assert.notEqual(transportGuard, -1)
  assert.ok(transportGuard < ttlCheck, 'the manual-mode guard must run before any other bundle-wait bookkeeping')

  const pollActivityStart = source.indexOf('async function pollChatGPTVisibleActivity()')
  const pollActivityEnd = source.indexOf('\nasync function performChatGPTRecoveryAction', pollActivityStart)
  assert.notEqual(pollActivityStart, -1)
  const pollActivity = source.slice(pollActivityStart, pollActivityEnd)
  const activityGuard = pollActivity.indexOf("chatgptTransportModes.get(key) === 'manual'")
  const firstProbe = pollActivity.indexOf('executeJavaScript(chatGPTHumanActionScript()')
  assert.notEqual(activityGuard, -1)
  assert.ok(activityGuard < firstProbe, 'the manual-mode guard must run before any DOM probe')

  const registerStart = source.indexOf('function registerChatGPTPlanDownloads(chatSession)')
  const registerEnd = source.indexOf('\nfunction publishBundleDownloadError', registerStart)
  assert.notEqual(registerStart, -1)
  const register = source.slice(registerStart, registerEnd)
  const downloadGuard = register.indexOf("chatgptTransportModes.get(sourceCacheKey) === 'manual'")
  const firstInterception = register.indexOf('canonicalWharnessBundleDownload(')
  assert.notEqual(downloadGuard, -1)
  assert.ok(downloadGuard < firstInterception, 'the manual-mode guard must run before any download interception')

  const handlerStart = source.indexOf("ipcMain.handle('wharness:chatgpt:set-transport-mode'")
  assert.notEqual(handlerStart, -1)
})

test('a re-click of the expected bundle download is guarded against an in-flight download, and delivered bundles are deduplicated by request id', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const pollStart = source.indexOf('async function pollExpectedChatGPTDownloadKey(key)')
  const pollEnd = source.indexOf('\nasync function pollExpectedChatGPTDownloads', pollStart)
  assert.notEqual(pollStart, -1)
  const poll = source.slice(pollStart, pollEnd)
  assert.match(poll, /if \(!expected\.downloadInFlight && \(!keepFlowing \|\| Number\(expected\.invalidBundleCount \|\| 0\) === 0\) && \(!expected\.lastDOMClick \|\| now - expected\.lastDOMClick >= DOM_DOWNLOAD_RETRY_MS\)\)/)
  assert.match(poll, /expected\.downloadInFlight = true/)

  const registerStart = source.indexOf('function registerChatGPTPlanDownloads(chatSession)')
  const registerEnd = source.indexOf('\nfunction publishBundleDownloadError', registerStart)
  assert.notEqual(registerStart, -1)
  const register = source.slice(registerStart, registerEnd)
  assert.match(register, /live\.downloadInFlight = false/)
  assert.match(register, /recentlyDeliveredChatGPTBundleRequestId\(validated\.requestId\)/)
  assert.match(register, /pendingChatGPTBundleDeliveries\.set\(validated\.requestId/)
  assert.match(poll, /pendingChatGPTBundleDeliveries\.has\(expected\.requestId\)\) return/)
  const ackStart = source.indexOf('async function acknowledgeChatGPTBundle(')
  const ackEnd = source.indexOf('\nfunction chatGPTPartitionPath', ackStart)
  assert.match(source.slice(ackStart, ackEnd), /markChatGPTBundleRequestDelivered\(id\)/)
})

test('bundle supervision cannot reload or probe a ChatGPT surface during transport preparation', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const directoryStart = source.indexOf('function pendingBundleDirectory()')
  const directoryEnd = source.indexOf('\nasync function pendingChatGPTBundlePayloads', directoryStart)
  assert.notEqual(directoryStart, -1)
  const directory = source.slice(directoryStart, directoryEnd)
  assert.match(directory, /app\.getPath\('userData'\)/)
  assert.match(directory, /pending-chatgpt-bundles-v1/)
  assert.doesNotMatch(directory, /app\.getPath\('temp'\)/)
})

test('an uncaught main-process exception or rejection is logged instead of silently crashing the whole app', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /process\.on\('uncaughtException', \(error\) => \{\s*console\.error\('\[main-process-fault\] uncaughtException', error\)/)
  assert.match(source, /process\.on\('unhandledRejection', \(reason\) => \{\s*console\.error\('\[main-process-fault\] unhandledRejection', reason\)/)
})

test('a second launch against the same userData profile hands off to the running instance instead of running two Chromium profiles at once', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const lockStart = source.indexOf('const customUserDataDir =')
  const lockEnd = source.indexOf('\nlet mainWindow', lockStart)
  assert.notEqual(lockStart, -1)
  const lockBlock = source.slice(lockStart, lockEnd)
  assert.match(lockBlock, /if \(!path\.isAbsolute\(customUserDataDir\)\) throw new Error\('WHARNESS_DESKTOP_USER_DATA_DIR must be an absolute path'\)/)
  assert.match(lockBlock, /app\.setPath\('userData', path\.normalize\(customUserDataDir\)\)/)
  assert.match(lockBlock, /if \(!app\.requestSingleInstanceLock\(\)\) \{\s*app\.quit\(\)/)
  assert.match(lockBlock, /app\.on\('second-instance', \(\) => \{/)
})

test('a dead main-frame renderer in the trusted window reloads the frontend instead of leaving a permanently blank window', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const createStart = source.indexOf('function createWindow(')
  const registerStart = source.indexOf('\nfunction registerIPC()', createStart)
  assert.notEqual(createStart, -1)
  const create = source.slice(createStart, registerStart)
  const targetIndex = create.indexOf("target.searchParams.set('wharnessRuntime', FRONTEND_RUNTIME_TOKEN)")
  const renderProcessGoneIndex = create.indexOf("win.webContents.on('render-process-gone'")
  assert.notEqual(targetIndex, -1)
  assert.notEqual(renderProcessGoneIndex, -1)
  assert.ok(targetIndex < renderProcessGoneIndex, 'target URL must be built before the crash handler closes over it')
  // The window must still come back — the reload is now paced and bounded
  // rather than immediate (see the backoff regression below), but a crashed
  // renderer must never be left as a permanently blank window.
  assert.match(create, /void win\.loadURL\(target\.href\)/)
  assert.match(create, /render-process-gone[\s\S]{0,900}?state\.rendererRestartTimer = setTimeout\(/)
})

// Moving a conversation into a ChatGPT project — which the account automation
// does deliberately — changes its URL to `/g/g-p-<project>/c/<id>`. Matching
// only the root `/c/<id>` form silently unbound the chat's affinity and left
// account operations unable to address the conversation by id, which surfaces
// to the user as `menu-unavailable`.
test('conversation ids are recovered from project-scoped conversation URLs', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function chatGPTConversationID(value)')
  const end = source.indexOf('\nfunction canonicalChatGPTConversationURL', start)
  assert.notEqual(start, -1)
  const body = source.slice(start, end)
  assert.match(body, /\(\?:\^\|\\\/\)c\\\/\(\[\^\/\?#\]\+\)/)
  assert.doesNotMatch(body, /\/\^\\\/c\\\//)
  // Transient creation URLs still never become durable affinity.
  assert.match(body, /WEB\(\?::\|%3A\)/)
})

// Account automation gives a background chat surface a real, full-size layout
// viewport so its renderer lays out and accepts trusted input — Electron clips
// a child view to its parent, so off-screen bounds collapse it to 0x0 and it
// stops receiving input entirely. Those bounds must therefore never be on
// screen: showing such a view before the renderer reports its real pane
// geometry covers the whole Wharnex window for a frame, which reads as the
// project closing and reopening.
test('a parked chat surface is never shown while it carries layout-only bounds', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  const parkStart = source.indexOf('function ensureChatGPTLayoutViewport(')
  const parkEnd = source.indexOf('\n// Locates a control', parkStart)
  const park = source.slice(parkStart, parkEnd)
  assert.match(park, /entry\.parkedLayout = true/)
  assert.doesNotMatch(park, /x: -\d+/)

  const predicateStart = source.indexOf('function chatGPTSurfaceShouldBeVisible(')
  const predicate = source.slice(predicateStart, source.indexOf('\n}', predicateStart))
  assert.match(predicate, /const parked = entry\.parkedLayout === true && !ownerState\.chatgptBounds/)
  assert.match(predicate, /Boolean\(ownerState\.chatgptVisible\) && !entry\.externalAuthProvider && !parked/)

  // Every path that makes an owned surface visible must share the predicate, or
  // a parked view slips through the one that does not - which is reachable now
  // that a slot carries layout bounds from the moment it is created.
  //
  // showChatAgentInteraction is the one legitimate exception: it is the Worker
  // interaction surface, not the Supervisor one, and it assigns real pane bounds
  // and clears parkedLayout on the line above the show.
  const interactionStart = source.indexOf('function showChatAgentInteraction(')
  const interactionEnd = source.indexOf('\nfunction ', interactionStart + 1)
  let shows = 0
  for (const match of source.matchAll(/entry\.view\.setVisible\(([^)]*)\)/g)) {
    const [, argument] = match
    if (argument === 'false') continue
    shows += 1
    if (match.index > interactionStart && match.index < interactionEnd) {
      assert.match(source.slice(interactionStart, interactionEnd), /entry\.parkedLayout = false\n\s*entry\.view\.setVisible\(true\)/)
      continue
    }
    assert.ok(
      argument.startsWith('chatGPTSurfaceShouldBeVisible('),
      `entry.view.setVisible(${argument}) bypasses the parked-surface predicate`,
    )
  }
  assert.ok(shows >= 4, 'expected the supervisor show paths to be covered')

  // Real pane bounds clear the parked flag, so the view becomes showable again.
  const boundsStart = source.indexOf('function setChatGPTBounds(')
  const boundsEnd = source.indexOf('\nfunction currentChatGPTState(', boundsStart)
  assert.match(source.slice(boundsStart, boundsEnd), /entry\.parkedLayout = false/)
})

// Rapidly cycling sandboxed renderers on the shared ChatGPT partition triggers
// Electron's "Cannot destructure property 'preloadScripts' of
// 'binding.startupData'" crash, which takes the trusted frontend renderer down
// with it and reloads the app. Deferred maintenance therefore drives only an
// already-resident surface instead of creating one for itself.
test('deferred remote archive reuses a leased worker and never allocates a new chat surface', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function archiveChatGPTConversation(')
  const end = source.indexOf('\nasync function deleteChatGPTConversation', start)
  assert.notEqual(start, -1)
  const body = source.slice(start, end)

  assert.match(body, /const entry = entryOverride \|\| chatgptViews\.get\(key\)/)
  assert.doesNotMatch(body, /ensureChatGPTView\(/)
  assert.match(body, /state: 'view-not-live'/)
  assert.match(body, /entry\.role === 'worker'/)
  assert.match(body, /entry\.ownerKey = ''/)
  assert.doesNotMatch(body, /ok: true, state: 'view-not-live'/)
})

// Reloading the instant a renderer dies can re-enter the same failure: a
// loadURL issued while a previous sandboxed renderer spawn is still settling is
// one of the ways Electron produces "Cannot destructure property
// 'preloadScripts' of 'binding.startupData'", so an immediate retry can turn a
// single crash into a reload loop.
test('frontend renderer crash recovery backs off and is bounded', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("win.webContents.on('render-process-gone'")
  const end = source.indexOf("win.webContents.on('unresponsive'", start)
  assert.notEqual(start, -1)
  const handler = source.slice(start, end)

  assert.match(handler, /state\.rendererRestarts >= FRONTEND_RENDERER_RESTART_LIMIT/)
  assert.match(handler, /Math\.min\(8_000, 500 \* \(2 \*\* \(state\.rendererRestarts - 1\)\)\)/)
  assert.match(handler, /setTimeout\(/)
  // The reload must not be issued synchronously from the crash event.
  const immediate = handler.indexOf('win.loadURL')
  const scheduled = handler.indexOf('state.rendererRestartTimer = setTimeout(')
  assert.ok(scheduled !== -1 && scheduled < immediate, 'reload must be scheduled, not immediate')
  assert.match(handler, /if \(quitting \|\| details\.reason === 'clean-exit'\) return/)

  // A renderer that stays up long enough clears the budget.
  assert.match(source, /state\.rendererRestarts = 0/)
})

// The DOM poller kept clicking the same download affordance after the bundle
// had already been delivered: each click genuinely re-downloaded the ZIP, the
// will-download handler dropped it as a duplicate, downloadInFlight cleared on
// `done`, and the next sweep clicked again — a hot loop that never progressed.
test('expected-bundle polling stops once the request has been delivered', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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

test('transient protocol ZIPs are deleted promptly and included in storage cleanup', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const fillStart = source.indexOf('async function fillBundledChatGPTComposer')
  const fillEnd = source.indexOf('\nasync function executeChatGPTDOMScript', fillStart)
  const fill = source.slice(fillStart, fillEnd)
  assert.notEqual(fillStart, -1)
  assert.match(fill, /try \{/)
  assert.match(fill, /finally \{/)
  assert.match(fill, /rm\(path\.dirname\(input\.archivePath\), \{ recursive: true, force: true \}\)/)

  const storageStart = source.indexOf('async function desktopStorageUsage()')
  const storageEnd = source.indexOf('\nasync function clearDesktopWharnessData', storageStart)
  const storage = source.slice(storageStart, storageEnd)
  assert.match(storage, /chat-protocol/)

  const clearStart = source.indexOf('async function clearDesktopWharnessData()')
  const clearEnd = source.indexOf('\nfunction chatGPTConversationID', clearStart)
  assert.match(source.slice(clearStart, clearEnd), /'wharness-chat-protocol'/)

  const readyStart = source.indexOf('app.whenReady().then(async () => {')
  const ready = source.slice(readyStart, readyStart + 500)
  assert.match(ready, /wharness-chat-protocol/)
  assert.match(ready, /recursive: true, force: true/)
})

test('Auto scale reconciles against the persisted policy ceiling', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function reconcileChatAgentAutoScale()')
  const end = source.indexOf('\nfunction reconcileChatGPTWorkerPool', start)
  const reconcile = source.slice(start, end)
  assert.notEqual(start, -1)
  assert.match(reconcile, /maxWorkers: chatAgentPolicies\.auto_scale_max_workers/)
  assert.doesNotMatch(reconcile, /maxWorkers: HARD_MAX_WORKER_SLOTS/)
})

test('worker scheduling keeps residency and slot mutation explicit', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /new ChatAgentResidency\(/)
  assert.match(source, /claimOptions: \(worker\) =>/)
  assert.match(source, /chatAgentResidency\.claimOptions\(entry\.slotId/)
  assert.match(source, /const transportKey = entry\.role === 'worker' \? `slot:\$\{entry\.slotId\}` : `chat:\$\{key\}`/)
  assert.match(source, /await waitForChatGPTSurfaceReady\(key, entry\)[\s\S]*chatAgentResidency\.settleAssignment/)
})

test('await-response is a passive resident probe with fixed healthy cadence', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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

test('request pacing samples only structurally extracted durations for valid bundles', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /chatGPTProcessingDurationScript\(CHATGPT_BEHAVIOR\.labels\.reasoningDisclosure, expected\.assistantBaseline\)/)
  assert.match(source, /request_eligible_at/)
  assert.match(source, /recordRateLimit\(source, classification\.kind\)/)

  const validateIndex = source.indexOf('validateWharnessBundleDownload')
  const recordIndex = source.indexOf('recordValidBundle', validateIndex)
  assert.notEqual(validateIndex, -1)
  assert.notEqual(recordIndex, -1)
  assert.ok(recordIndex > validateIndex, 'processing samples must be recorded only after bundle validation')
})

test('runtime queue diagnostics separate deferred work from claimable backlog', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function chatAgentQueueDiagnostics(')
  const end = source.indexOf('\nasync function refreshChatAgentRuntimeState', start)
  const diagnostics = source.slice(start, end)

  // A task deferred behind not_before waits on a clock, not on a worker.
  assert.match(diagnostics, /due:/)
  assert.match(diagnostics, /scheduled:/)
  assert.match(diagnostics, /guarded:/)
  assert.match(diagnostics, /oldest_due_created_at:/)
  assert.doesNotMatch(diagnostics, /oldest_created_at:/)

  const refreshStart = source.indexOf('async function refreshChatAgentRuntimeState(')
  const refresh = source.slice(refreshStart, source.indexOf('\nfunction chatAgentRuntimeState', refreshStart))
  // The aggregate is computed by the store: counting a capped, oldest-first
  // list stops being true once settled history fills that window.
  assert.match(refresh, /chatAgentScheduler\.queueSummary\(\)/)
  assert.doesNotMatch(refresh, /chatAgentScheduler\.list\(\{ limit: 500 \}\)/)
})

test('idle Supervisor state never validates an absent task as a cache key', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function chatAgentRuntimeState()')
  const runtime = source.slice(start, source.indexOf('\nfunction publishChatAgentRuntimeState', start))

  assert.match(runtime, /sanitizeOptionalChatCacheKey\(runtime\.task\?\.chat_id\)/)
  assert.doesNotMatch(runtime, /sanitizeChatCacheKey\(runtime\.task\?\.chat_id/)
})

test('a hidden Worker gets a layout viewport even while it owns the Supervisor selected chat', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function ensureChatGPTLayoutViewport(')
  const viewport = source.slice(start, source.indexOf('\n}', source.indexOf('return true', start)))

  // Identifying the visible surface by chat key alone left a hidden Worker at
  // 0x0 whenever it owned the selected chat, so every located account control
  // measured as offscreen and the task burned its whole attempt budget.
  assert.match(viewport, /ownerState\?\.activeChatGPTKey === key && chatgptViews\.get\(key\) === entry/)
  assert.doesNotMatch(viewport, /if \(ownerState\?\.activeChatGPTKey === key\) return false/)
})

// Measured on Electron 44: a WebContentsView given bounds while already hidden
// reports a 0x0 viewport to its renderer, because Electron delivers a resize
// only while the view is visible. The identical view given the same bounds
// before being hidden reports 1280x900 and keeps it across later navigations.
//
// A chat slot left at 0x0 fails account automation twice over: every located
// control's centre lies outside the viewport, so `rect()` returns null and the
// operation reports `action-offscreen`; and every percentage-width node
// collapses to width 0, so the shared `visible()` predicate rejects it.
test('a chat slot is given its layout viewport before it is ever hidden', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  const grantStart = source.indexOf('function grantChatGPTLayoutViewport(')
  assert.ok(grantStart > 0, 'grantChatGPTLayoutViewport must exist')
  const grant = source.slice(grantStart, source.indexOf('\n}', grantStart))
  // visible -> resize -> hidden, in that order. No compositor frame is produced
  // between the two setVisible calls, so the view never appears on screen -
  // which only holds while the sequence stays synchronous.
  assert.match(grant, /setVisible\(true\)[\s\S]*setBounds\([\s\S]*setVisible\(false\)/)
  assert.doesNotMatch(grant, /await/)

  const supervisorStart = source.indexOf('function createChatGPTView(')
  const supervisor = source.slice(supervisorStart, source.indexOf('\n  const wc = view.webContents', supervisorStart))
  assert.doesNotMatch(supervisor, /view\.setVisible\(false\)/)
  assert.match(supervisor, /addChildView\(view\)\n\s*grantChatGPTLayoutViewport\(view\)/)
  assert.match(supervisor, /layoutViewportGranted: true/)

  const workerStart = source.indexOf('function createChatGPTWorkerView(')
  const worker = source.slice(workerStart, source.indexOf('\n  const wc = view.webContents', workerStart))
  assert.doesNotMatch(worker, /view\.setVisible\(false\)/)
  assert.doesNotMatch(worker, /addChildView\(view\)/)
  assert.match(worker, /grantChatGPTLayoutViewport\(view\)/)
  assert.match(worker, /layoutViewportGranted: true/)
})

test('background native input preserves the already-focused local composer', async () => {
  const [source, guard] = await Promise.all([
    readFile(new URL('./main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./local-focus-guard.mjs', import.meta.url), 'utf8'),
  ])
  const helperStart = source.indexOf('function focusedLocalWharnexContents()')
  const helper = source.slice(helperStart, source.indexOf('\nfunction ensureChatGPTLayoutViewport(', helperStart))
  assert.ok(helperStart > 0)
  assert.match(helper, /BrowserWindow\.getFocusedWindow\(\)/)
  assert.match(helper, /contents\.isFocused\(\)/)
  assert.match(helper, /preserveLocalFocusDuringBackgroundOperation/)
  assert.match(helper, /BrowserWindow\.fromWebContents\(contents\)/)
  assert.doesNotMatch(helper, /view\.webContents\.focus\(|wc\.focus\(/)
  assert.match(guard, /BACKGROUND_NATIVE_FOCUS_RESTORE_DELAYS_MS = \[0, 16, 48\]/)
  assert.match(guard, /isOwnerFocused\?\.\(owner\)/)

  const accountStart = source.indexOf('async function commitChatGPTAccountControl(')
  const account = source.slice(accountStart, source.indexOf('\nasync function chooseChatGPTConversationAction', accountStart))
  assert.match(account, /withPreservedLocalFocus\(\(\) => dispatchChatGPTPointerClick/)

  const submitStart = source.indexOf('async function submitChatGPTDraft(')
  const submit = source.slice(submitStart, source.indexOf('\nasync function preparePromptForChatGPT', submitStart))
  assert.match(submit, /withPreservedLocalFocus\(\(\) => dispatchChatGPTEffortCycle/)
})

test('the layout viewport guard does not read native bounds as renderer evidence', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function ensureChatGPTLayoutViewport(')
  const viewport = source.slice(start, source.indexOf('\n}', source.indexOf('return true', start)))

  // getBounds() reports the bounds that were *set*, not the viewport the page
  // actually has. The first ineffective setBounds therefore made this guard
  // report 1280x900 forever after, so no later call could repair the slot -
  // which is why every ORGANIZE_CHAT attempt failed identically until the task
  // exhausted its budget.
  assert.doesNotMatch(viewport, /entry\.view\.getBounds/)
  assert.match(viewport, /entry\.layoutViewportGranted === true\) return false/)
  assert.match(viewport, /grantChatGPTLayoutViewport\(entry\.view\)/)

  // Re-parenting rebuilds the native hierarchy, so the grant has to be redone.
  const rehomeStart = source.indexOf('function rehomeChatGPTWorkers(')
  const rehome = source.slice(rehomeStart, source.indexOf('\n}', rehomeStart))
  assert.match(rehome, /grantChatGPTLayoutViewport\(entry\.view\)/)
})

test('an offscreen account control reports the viewport that measured it', async () => {
  const [account, agent] = await Promise.all([
    readFile(new URL('./chatgpt-account.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./chat-agent-scripts.mjs', import.meta.url), 'utf8'),
  ])

  // Without this, "the slot has no layout viewport" and "the control is
  // genuinely scrolled out of view" are the same opaque string in the task's
  // last_error, which is what let the 0x0 fault stay invisible across dozens of
  // identical failures. The viewport is control geometry, never page content.
  for (const source of [account, agent]) {
    for (const [, state] of source.matchAll(/state: '([a-z-]*offscreen)'/g)) {
      const occurrence = new RegExp(`state: '${state}', viewport: viewport\\(\\)`)
      assert.match(source, occurrence, `${state} must report the measuring viewport`)
    }
    assert.match(source, /const viewport = \(\) => \(\{ w: innerWidth, h: innerHeight \}\)/)
  }
})

test('AWAIT_RESPONSE confirms a completion before concluding the bundle is missing', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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
  // Continuations are real ChatGPT requests and must be spaced.
  assert.match(probe, /BUNDLE_CONTINUATION_BASE_MS/)
  assert.match(probe, /lastContinuationAt/)
})

test('autonomous submissions are spaced process-wide and re-check the provider cooldown', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeChatAgentWrite(')
  const write = source.slice(start, source.indexOf('\nasync function enqueueChatAgentFollowups', start))

  // Transport is serialized per Worker slot, which bounds one slot but not the
  // pool: every free slot could otherwise submit at once against one account.
  assert.match(write, /await paceChatGPTWorkerSubmission\(\)/)
  assert.match(write, /chatAgentRateLimitDelayMs\(\)/)

  // The spacing is now derived rather than fixed, so a resumed pool does not
  // rebuild the burst; the healthy floor is still CHAT_AGENT_SUBMIT_GAP_MS.
  const pacer = source.slice(source.indexOf('async function paceChatGPTWorkerSubmission('))
  assert.match(pacer.slice(0, 600), /chatAgentSubmissionGapMs\(\)/)
  const gapStart = source.indexOf('function chatAgentSubmissionGapMs(')
  const gap = source.slice(gapStart, source.indexOf('\nasync function paceChatGPTWorkerSubmission(', gapStart))
  assert.match(gap, /CHAT_AGENT_SUBMIT_GAP_MS/)
})

test('a worker that takes a task yields its place in the rotation', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeChatAgentTask(')
  const execute = source.slice(start, source.indexOf('\n  switch (task.type)', start))
  assert.match(execute, /chatAgentResidency\.noteAssignment\(entry\.slotId\)/)
})


test('translation worker is transport only: it uploads the engine’s bundle and returns bytes it never reads', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const executeStart = source.indexOf('async function executeChatAgentMarkdownTranslation(')
  const executeEnd = source.indexOf('\nasync function chatAgentLifecycleRetry', executeStart)
  const worker = source.slice(executeStart, executeEnd)
  assert.notEqual(executeStart, -1)
  assert.match(worker, /chatGPTExpectedDownloadScript\(filename, assistantBaseline\)/)
  assert.match(worker, /chatGPTResponseCompletionScript\(assistantBaseline\)/)
  assert.doesNotMatch(worker, /textContent|innerText|chatGPTVisibleActivityScript/)
  assert.match(worker, /expectedChatGPTTranslations\.set\(filename, expected\)/)
  assert.match(worker, /target\.reasoningEffort = 'instant'/)
  assert.ok(worker.indexOf("target.reasoningEffort = 'instant'") < worker.indexOf('await submitChatGPTDraft('))

  // Everything the provider is asked for was authored by the backend engine and
  // sealed into the request archive. The worker uploads it and submits the
  // bounded bootstrap; it composes no instruction of its own, because an
  // instruction built here could not be validated by the side that reads the
  // answer.
  assert.match(worker, /wharness\.translation-input\/v1/)
  assert.match(worker, /payload\.archive_base64/)
  assert.match(worker, /chatGPTFillComposerScript\(bootstrap\)/)
  assert.doesNotMatch(worker, /Translate the attached/)
  assert.doesNotMatch(worker, /markdownTranslationLanguageName/)

  // It returns the downloaded bytes unopened: parsing here would put the
  // protocol in two places, and only one of them wrote the request.
  assert.match(worker, /bundle_base64: outcome\.value\.toString\('base64'\)/)
  assert.doesNotMatch(worker, /markdown: outcome\.value/)

  const downloadStart = source.indexOf('function registerChatGPTMarkdownTranslationDownload(')
  const downloadEnd = source.indexOf('\nfunction registerChatGPTPlanDownloads', downloadStart)
  const download = source.slice(downloadStart, downloadEnd)
  assert.match(download, /MAX_MARKDOWN_TRANSLATION_RESULT_BYTES/)
  assert.match(download, /expected\.resolve\(bytes\)/)
  assert.doesNotMatch(download, /new TextDecoder/)
  assert.match(download, /\^whx_translation_res_cat_\[a-f0-9\]\{20\}\\\.zip\$/)
})


test('TODO classification worker keeps the provider exchange bundle-only', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const executeStart = source.indexOf('async function executeChatAgentTodoClassification(')
  const executeEnd = source.indexOf('\nasync function chatAgentLifecycleRetry', executeStart)
  const worker = source.slice(executeStart, executeEnd)
  assert.notEqual(executeStart, -1)
  assert.match(worker, /wharness\.todo-classification-input\/v1/)
  assert.match(worker, /chatGPTFillComposerScript\(bootstrap\)/)
  assert.match(worker, /chatGPTExpectedDownloadScript\(filename, assistantBaseline\)/)
  assert.match(worker, /bundle_base64: outcome\.value\.toString\('base64'\)/)
  assert.doesNotMatch(worker, /textContent|innerText|JSON\.parse\(outcome\.value/)
  assert.match(worker, /target\.reasoningEffort = 'instant'/)

  const downloadStart = source.indexOf('function registerChatGPTTodoClassificationDownload(')
  const downloadEnd = source.indexOf('\nfunction registerChatGPTPlanDownloads', downloadStart)
  const download = source.slice(downloadStart, downloadEnd)
  assert.match(download, /MAX_TODO_CLASSIFICATION_BYTES/)
  assert.match(download, /expected\.resolve\(bytes\)/)
})

test('orchestrator planning survives as an exact artifact-only Worker delivery', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const executeStart = source.indexOf('async function executeChatAgentOrchestratorPlan(')
  const executeEnd = source.indexOf('\nasync function executeChatAgentMarkdownTranslation', executeStart)
  const worker = source.slice(executeStart, executeEnd)
  assert.notEqual(executeStart, -1)
  assert.match(worker, /harness\.orchestrator-planning\/v1/)
  assert.match(worker, /chatGPTExpectedDownloadScript\(filename, assistantBaseline\)/)
  assert.match(worker, /chatGPTResponseCompletionScript\(assistantBaseline\)/)
  // One import path for the live download, a retained artifact and both
  // deliveries, so nothing reaches the backend through a weaker check.
  assert.match(worker, /importOrchestratorPlanArtifact\(sessionId, requestId, delivery, outcome\.value\)/)
  const dispatch = source.slice(source.indexOf('async function importOrchestratorPlanArtifact('), source.indexOf('\n// A retained artifact is best-effort'))
  assert.match(dispatch, /delivery === 'bundle'/)
  assert.match(dispatch, /importOrchestratorWorkerPlanBundle\(sessionId, requestId, bytes\)/)
  // The legacy artifact still goes through the strict JSON parser.
  assert.match(dispatch, /parseOrchestratorPlanProposal\(text\)/)
  const parser = source.slice(source.indexOf('function parseOrchestratorPlanProposal('), source.indexOf('\nfunction orchestratorPlanResult('))
  assert.match(parser, /harness\.orchestrator-plan\/v1/)
  assert.match(parser, /Array\.isArray\(proposal\.tasks\)/)
  assert.match(worker, /checkpointChatAgentTask\(task\.task_id, owner/)
  assert.match(worker, /canonicalChatGPTConversationURL\(payload\.conversation_url/)
  assert.match(worker, /orchestrator-checkpoint/)
  assert.match(worker, /terminalCleanup \|\| Number\(task\.attempt/)
  assert.doesNotMatch(worker, /textContent|innerText|chatGPTVisibleActivityScript/)

  const downloadStart = source.indexOf('function registerChatGPTOrchestratorPlanDownload(')
  const downloadEnd = source.indexOf('\nfunction registerChatGPTPlanDownloads', downloadStart)
  const download = source.slice(downloadStart, downloadEnd)
  assert.match(download, /MAX_ORCHESTRATOR_PLAN_BYTES/)
  // Strict UTF-8 validation moved to the import dispatch with the rest of the
  // legacy JSON handling; the download layer now carries raw bytes so a bundle
  // can be uploaded verbatim.
  const dispatchDecode = source.slice(source.indexOf('async function importOrchestratorPlanArtifact('), source.indexOf('\n// A retained artifact is best-effort'))
  assert.match(dispatchDecode, /new TextDecoder\('utf-8', \{ fatal: true \}\)/)
  assert.match(download, /\^whx_orchestrator_plan_cat_/)
  assert.match(source, /case 'ORCHESTRATOR_PLAN': return executeChatAgentOrchestratorPlan/)
})

// The diagnostic is only worth collecting if it survives to the task row. Every
// intermediate return in the organize/ensure-project flow used to rebuild a bare
// { ok, state, project } object, which discarded the viewport and control counts
// the script had just measured — so `accountFailureDetail` saw a bare state and
// the failure stayed as opaque as before.
test('account diagnostics survive the organize flow instead of being rebuilt away', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  for (const factory of ['async function ensureChatGPTProject(', 'async function organizeChatGPTConversation(']) {
    const start = source.indexOf(factory)
    assert.ok(start > 0, `${factory} must exist`)
    const body = source.slice(start, source.indexOf('\n}', start))
    for (const [, returned] of body.matchAll(/if \(![a-zA-Z]+\.ok\) return (\{[^}]*\})/g)) {
      assert.match(returned, /^\{ \.\.\./, `${returned} drops the measured diagnostic`)
    }
  }
})

test('no AWAIT_RESPONSE outcome that never reached ChatGPT spends the attempt budget', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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
  assert.match(source, /const AWAIT_STALL_ATTENTION_MS = 10 \* 60_000/)

  // An active provider cooldown is likewise not an attempt.
  const execute = source.slice(source.indexOf('async function executeChatAgentTask('))
  assert.match(execute.slice(0, 900), /initialRateLimitDelay, observation: true/)
})

test('the cross-chat navigation gate follows the provider instead of one fixed clock', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const gap = source.slice(source.indexOf('function chatAgentNavigationGapMs('))

  // Navigation is serialized process-wide, so a fixed 30-second ceiling let the
  // whole pool rebind twice a minute however many workers were free.
  assert.match(gap.slice(0, 900), /rate_limit_level/)
  assert.match(gap.slice(0, 900), /CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS/)
  assert.match(gap.slice(0, 900), /CHATGPT_WORKER_NAVIGATION_GAP_MS/)
  assert.match(source, /const CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS = 6_000/)

  const pacer = source.slice(source.indexOf('async function paceChatGPTWorkerNavigation('))
  assert.match(pacer.slice(0, 600), /chatAgentNavigationGapMs\(\)/)
  assert.doesNotMatch(pacer.slice(0, 600), /CHATGPT_WORKER_NAVIGATION_GAP_MS -/)
})

test('an empty claim releases a resident lane that has run dry', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))

  // Without this the pool degraded to one effective worker: a resident slot can
  // only claim its own lane, so it could never be rebound by claiming elsewhere.
  assert.match(scheduler.slice(0, 3600), /onIdle: \(worker\) => \{/)
  assert.match(scheduler.slice(0, 3600), /chatAgentResidency\.noteIdleClaim\(entry\.slotId\)/)
})

test('a conversation still producing a response is never concluded without evidence it ran', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function probeChatAgentResponse(')
  const probe = source.slice(start, source.indexOf('\nasync function executeChatAgentWrite', start))

  // The ordinary grace means "generation visibly stopped and stayed stopped",
  // which is only meaningful once that indicator was actually seen. Without it
  // the window degraded to "the page has looked static since we first looked" —
  // true of a turn that has not started and of a gap between reasoning phases.
  assert.match(probe, /expected\.processingObservedAt \? PROCESSING_SIGNAL_GRACE_MS : BUNDLE_UNOBSERVED_SETTLE_MS/)
  assert.match(probe, /now - idleSince < settleWindow/)
  assert.match(source, /const BUNDLE_UNOBSERVED_SETTLE_MS = 3 \* 60_000/)
})

test('live response residency is pinned so excess chats cannot cause navigation thrash', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))
  assert.match(scheduler.slice(0, 1800), /pinResident: chatAgentSupervisingLiveResponse\(worker\)/)
  assert.match(source, /const MAX_BUNDLE_CONTINUATIONS = 3/)
  assert.match(source, /chatGPTDeliveryContinuationPrompt\(expected\.requestId, expected\.filename, expected\.originalPrompt\)/)
})

test('supervision scheduled after a write waits for the turn to start', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeChatAgentWrite(')
  const write = source.slice(start, source.indexOf('\nasync function enqueueOrganizeFromTitle', start))

  // Measured: a recovery write at 12:42:56 reached ATTENTION at 12:43:17 because
  // its supervision was claimable in the same second and read the turn before it.
  assert.match(write, /notBefore: new Date\(Date\.now\(\) \+ chatAgentInitialRequestWaitMs\(\)\)\.toISOString\(\)/)
})

test('auxiliary conflict surfaces never overwrite the primary durable chat affinity', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const helper = source.slice(source.indexOf('function durableWorkspaceChatID('), source.indexOf('\nfunction chatAgentTaskPayload', source.indexOf('function durableWorkspaceChatID(')))
  assert.match(helper, /_cf_/)
  assert.match(helper, /return ''/)

  const prepare = source.slice(source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)'), source.indexOf('\nasync function retryPersistedChatGPTPrompt', source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined)')))
  assert.match(prepare, /durableWorkspaceChatID\(key, request\?\.workspaceChatId\)/)
  assert.match(prepare, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort/)

  const write = source.slice(source.indexOf('async function executeChatAgentWrite('), source.indexOf('\nasync function enqueueOrganizeFromTitle', source.indexOf('async function executeChatAgentWrite(')))
  assert.match(write, /durableWorkspaceChatID\(key, payload\.workspace_chat_id\)/)
  assert.match(write, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort/)

  const resume = source.slice(source.indexOf("ipcMain.handle('wharness:chatgpt:resume-expected-bundle'"), source.indexOf("ipcMain.handle('wharness:chatgpt:continue-expected-bundle'"))
  assert.match(resume, /durableWorkspaceChatID\(key, request\?\.workspaceChatId\)/)
  assert.match(resume, /if \(workspaceChatId\) await persistWorkspaceChatRemoteBestEffort\(workspaceChatId/)
  assert.match(resume, /sessionId: request\?\.sessionId, workspaceChatId/)
})

test('a slot between two observations of a live response keeps its conversation', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const helper = source.slice(source.indexOf('function chatAgentSupervisingLiveResponse('))
  assert.match(helper.slice(0, 400), /lastTask\?\.type === 'AWAIT_RESPONSE' && runtime\?\.lastResult\?\.status === 'waiting'/)

  const scheduler = source.slice(
    source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('),
    source.indexOf('chatAgentScheduler.start()'))
  // Releasing the lane here would hand the conversation to another slot, which
  // would reload a page the model is still writing into.
  assert.match(scheduler, /if \(chatAgentSupervisingLiveResponse\(worker\) \|\| chatAgentKeepFlowingActive\(worker\)\) return/)
  // The predicate needs the settled result, so the runtime state has to keep it.
  assert.match(scheduler, /kind === 'settled'[\s\S]{0,200}lastResult: state\.result/)
})

test('any trusted ChatGPT backend 429 is provider-wide evidence, not just the conversation endpoints', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function noteChatGPTHTTPStatus(')
  const handler = source.slice(start, source.indexOf('\nfunction settleChatGPTAffinityAfterSubmit', start))
  // The narrow predicate is what let a submission burst refuse on a sibling
  // endpoint while the pool never paused.
  assert.match(handler, /status === 429 && \(details\?\.resourceType === 'mainFrame' \|\| isChatGPTBackendAPIURL\(details\?\.url\)\)/)
  assert.match(handler, /applyChatGPTRateLimit\(key, \{/)
})

test('an account-wide rate-limit gate suspends the provider for the fixed window', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(source, /const CHATGPT_RATE_LIMIT_GATE_MS = 30 \* 60_000/)

  const start = source.indexOf('function applyChatGPTRateLimit(')
  const apply = source.slice(start, source.indexOf('\nfunction noteChatGPTRateLimitGate(', start))
  assert.match(apply, /classifyChatGPTRateLimit\(chatGPTRateLimitHits, \{ now, domGate \}\)/)
  assert.match(apply, /gate \? CHATGPT_RATE_LIMIT_GATE_MS : CHATGPT_RATE_LIMIT_BACKOFF_MS/)
  // The kind has to reach the durable store, or the backend keeps applying the
  // five-minute ladder step to an account-wide block.
  assert.match(apply, /recordRateLimit\(source, classification\.kind\)/)
})

test('workers stop claiming while the provider cooldown is active', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const scheduler = source.slice(source.indexOf('chatAgentScheduler = new ChatAgentSchedulerClient('))
  const claimOptions = scheduler.slice(scheduler.indexOf('claimOptions: (worker)'), scheduler.indexOf('onIdle:'))
  // Claiming during a cooldown charges an attempt to every task it touches and
  // hands each one straight back to WAITING.
  assert.match(claimOptions, /if \(chatAgentRateLimitDelayMs\(\) > 0\) return \{ skip: true \}/)
})

test('a detected gate returns the worker without spending the task attempt budget', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const gate = source.slice(source.indexOf('function noteChatGPTRateLimitGate('), source.indexOf('\nfunction noteChatGPTHTTPStatus('))
  assert.match(gate, /health\?\.rateLimited !== true/)
  assert.match(gate, /domGate: true/)

  // Every supervision path that probes health must hand the slot back as a
  // passive observation, which is what returns the attempt.
  const observations = source.match(/noteChatGPTRateLimitGate\(key, health\)\) \{\n\s+return \{ status: 'waiting'[^}]*observation: true/g) || []
  assert.ok(observations.length >= 3, `expected every probing task path to observe, saw ${observations.length}`)
})

test('submission pacing widens after rate-limit pressure and decays back on its own', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const gap = source.slice(source.indexOf('function chatAgentSubmissionGapMs('), source.indexOf('\nasync function paceChatGPTWorkerSubmission('))
  assert.match(gap, /rate_limit_level/)
  assert.match(gap, /CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS/)
  // Healthy provider keeps the floor: a permanent ceiling would serialize the
  // pool long after the account recovered.
  assert.match(gap, /if \(level <= 0 && !recentlyLimited\) return CHAT_AGENT_SUBMIT_GAP_MS/)

  const pace = source.slice(source.indexOf('async function paceChatGPTWorkerRequest('), source.indexOf('async function loadAndSettleChatGPTWorkerConversation('))
  assert.match(pace, /Math\.max\(CHAT_AGENT_SUBMIT_GAP_MS, Number\(gapMs\) \|\| 0\)/)
  assert.match(pace, /chatGPTWorkerRequestTail/)
  assert.match(pace, /chatGPTWorkerLastRequestAt/)
  assert.match(pace, /paceChatGPTWorkerNavigation\(\)[\s\S]*paceChatGPTWorkerRequest\(chatAgentNavigationGapMs\(\)\)/)
  assert.match(pace, /paceChatGPTWorkerSubmission\(\)[\s\S]*paceChatGPTWorkerRequest\(chatAgentSubmissionGapMs\(\)\)/)
})

test('task-scoped Keep flowing survives WAITING and ends when that task is terminal', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function chatAgentTaskKeepFlowingSponsored(')
  const sponsorship = source.slice(start, source.indexOf('function chatAgentKeepFlowingFloor(', start))
  assert.match(sponsorship, /chatAgentTaskKeepFlowing\(runtime\?\.task\)/)
  assert.match(sponsorship, /lastResult\?\.status[\s\S]*=== 'waiting'/)
  assert.match(sponsorship, /chatAgentTaskKeepFlowing\(runtime\?\.lastTask\)/)
  assert.match(sponsorship, /chatAgentTaskKeepFlowingSponsored\(runtime\)/)
  assert.match(source, /chatAgentKeepFlowingActive\(worker\) \? 'claimed' : 'idle'/)
  assert.match(source, /keep_flowing: task\.keep_flowing === true/)
})

test('a Desktop restart during a suspension adopts the durable deadline instead of resuming', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function refreshChatAgentRuntimeState(')
  const refresh = source.slice(start, source.indexOf('\nfunction publicAgentBrowser(', start))
  // The local clock is a mirror reset by every restart; the backend owns the
  // cooldown, so the persisted deadline has to be adopted on refresh.
  assert.match(refresh, /provider\?\.paused === true && Number\.isFinite\(pausedUntil\)/)
  assert.match(refresh, /chatGPTRateLimitUntil = Math\.max\(chatGPTRateLimitUntil, pausedUntil\)/)
  // Measured: pausing the provider and then resuming it left every worker
  // skipping its claim until a local deadline nobody could see expired. The
  // mirror must follow the durable state down as well as up.
  assert.match(refresh, /else if \(provider\?\.paused === false\) \{[\s\S]*?chatGPTRateLimitUntil = 0/)
  // A refresh already in flight while a 429 is being persisted still reports
  // paused:false. Obeying it would release the pool into the burst the gate
  // was just raised against, so only a reading that knows about the newest
  // local gate may clear the mirror.
  assert.match(refresh, /observedAt >= chatGPTRateLimitAppliedAt/)
  const apply = source.slice(source.indexOf('function applyChatGPTRateLimit('), source.indexOf('\nfunction noteChatGPTRateLimitGate('))
  assert.match(apply, /chatGPTRateLimitAppliedAt = now/)
})

test('a plan delivered between attempts is retained instead of cancelled', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function registerChatGPTOrchestratorPlanDownload(')
  const download = source.slice(start, source.indexOf('\nfunction registerChatGPTPlanDownloads', start))
  // Measured: four planning requests reached attempt 7/8 with zero plans
  // imported, because ChatGPT delivers when it finishes rather than while a
  // lease is open, and an unarmed artifact was cancelled.
  assert.match(download, /return retainChatGPTOrchestratorPlanDownload\(item, filename\)/)
  assert.doesNotMatch(download.slice(0, download.indexOf('const total')), /item\.cancel\(\)/)

  const retain = source.slice(source.indexOf('function retainChatGPTOrchestratorPlanDownload('), source.indexOf('\n// Claim a retained artifact'))
  // The filename carries its own task id, so a retained plan can only be
  // claimed by the attempt that owns it.
  assert.match(retain, /whx_orchestrator_plan_\(cat_\[a-f0-9\]\{20\}\)\\\.json/)
  assert.match(retain, /MAX_ORCHESTRATOR_PLAN_BYTES/)
  assert.match(retain, /chatGPTOrchestratorPlanInbox\.set\(filename/)
})

test('a retained plan is imported before spending another provider request', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeChatAgentOrchestratorPlan(')
  const worker = source.slice(start, source.indexOf('\nasync function executeChatAgentMarkdownTranslation', start))
  const retainIndex = worker.indexOf('takeRetainedChatGPTOrchestratorPlan(filename)')
  const submitIndex = worker.indexOf('targetChatGPTComposer(')
  assert.ok(retainIndex > -1, 'the attempt must look for a retained plan')
  assert.ok(retainIndex < submitIndex, 'the retained plan must be claimed before any new submission')

  // The inbox is bounded so a retained artifact cannot accumulate forever.
  assert.match(source, /const ORCHESTRATOR_PLAN_INBOX_MAX = \d+/)
  assert.match(source, /const ORCHESTRATOR_PLAN_INBOX_TTL_MS/)
  assert.match(source, /function pruneChatGPTOrchestratorPlanInbox\(/)
})

test('a plan still being produced at the lease deadline is observed, not failed', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeChatAgentOrchestratorPlan(')
  const worker = source.slice(start, source.indexOf('\nasync function executeChatAgentMarkdownTranslation', start))
  // An 8-minute lease is shorter than a large DAG takes to plan. Throwing at
  // the deadline charged an attempt for a page that was visibly still working,
  // and sent the next lease to reload a conversation mid-generation.
  assert.match(worker, /if \(completion\?\.thinking === true\) thinkingObservedAt = Date\.now\(\)/)
  assert.match(worker, /thinkingObservedAt && Date\.now\(\) - thinkingObservedAt < ORCHESTRATOR_PLAN_GENERATING_GRACE_MS/)
  const observeIndex = worker.indexOf('ORCHESTRATOR_PLAN_GENERATING_GRACE_MS')
  const throwIndex = worker.indexOf('did not provide ${filename} before the orchestrator planning timeout')
  assert.ok(observeIndex < throwIndex, 'the still-generating check must precede the timeout failure')
  assert.match(worker.slice(observeIndex, throwIndex), /observation: true/)
})

test('a slot rebound before execution never charges the task attempt budget', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeChatAgentTask(')
  const execute = source.slice(start, source.indexOf('\n  switch (task.type)', start))
  // Nothing reached ChatGPT, so AGENTS.md requires this outcome to be free.
  assert.match(execute, /stale worker assignment/i)
  assert.match(execute, /status: 'waiting', observation: true, delayMs: CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS/)
})

test('an expired ChatGPT artifact is re-requested instead of clicked forever', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  // Measured live: 134 clicks against two dead file cards in one lease. The
  // card stays rendered after ChatGPT collects the artifact behind it, so the
  // 404 on its own download endpoint is the only evidence the file is gone.
  const detector = source.slice(source.indexOf('function chatGPTInterpreterDownloadConversation('), source.indexOf('\nfunction noteChatGPTExpiredArtifact('))
  assert.match(detector, /backend-api\\\/conversation\\\/\(\[A-Za-z0-9-\]\{1,128\}\)\\\/interpreter\\\/download/)

  const httpStatus = source.slice(source.indexOf('function noteChatGPTHTTPStatus('), source.indexOf('\nfunction settleChatGPTAffinityAfterSubmit'))
  assert.match(httpStatus, /status === 404/)
  assert.match(httpStatus, /noteChatGPTExpiredArtifact\(expiredConversation\)/)

  const worker = source.slice(source.indexOf('async function executeChatAgentOrchestratorPlan('), source.indexOf('\nasync function executeChatAgentMarkdownTranslation'))
  assert.match(worker, /chatGPTArtifactExpiredSince\(chatAgentConversationID\(conversationUrl\), lastRequestedAt\)/)
  // Bounded, and it must not restart the planning work it already did.
  assert.match(worker, /rerequests >= MAX_BUNDLE_CONTINUATIONS/)
  // Once the artifacts are collected the conversation can never deliver again,
  // so exhaustion clears the checkpoint and the next attempt starts fresh
  // instead of resuming the same dead conversation until the budget runs out.
  assert.match(worker, /conversation_url: '', expected_filename: '', assistant_baseline: 0/)
  assert.match(worker, /orchestratorPlanInstruction\(prompt, filename, true\)/)
  const instruction = source.slice(source.indexOf('function orchestratorPlanInstruction('), source.indexOf('\n// Validate and import one orchestrator plan artifact'))
  assert.match(instruction, /Do not re-plan and do not change the plan/)
  // One definition, so a re-request cannot ask for something else.
  assert.match(worker, /orchestratorPlanInstruction\(prompt, filename, false\)/)
})

test('orchestrator planning delivers the project standard response bundle', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  // The planning result uses the same ZIP transport and naming contract as
  // every other planner artifact instead of a bare JSON file of its own.
  const naming = source.slice(source.indexOf('function orchestratorBundleFilename('), source.indexOf('\n// A checkpoint written under the old contract'))
  assert.match(naming, /buildBundleName\('res', 'orchestrator', id\)/)
  assert.match(naming, /\^orp_\[0-9\]\{8\}T\[0-9\]\{6\}_\[0-9a-f\]\{16\}\$/)

  // A request already checkpointed under the legacy contract finishes on it.
  const delivery = source.slice(source.indexOf('function orchestratorDeliveryFor('), source.indexOf('\nasync function importOrchestratorWorkerPlanBundle('))
  assert.match(delivery, /endsWith\('\.json'\) \? 'json' : 'bundle'/)

  const worker = source.slice(source.indexOf('async function executeChatAgentOrchestratorPlan('), source.indexOf('\nasync function executeChatAgentMarkdownTranslation'))
  assert.match(worker, /delivery === 'bundle' \? orchestratorBundleFilename\(requestId\) : orchestratorPlanFilename\(task\.task_id\)/)

  // The Desktop is transport: it uploads the archive verbatim and the backend
  // is the single place untrusted planner bytes are opened and validated.
  const upload = source.slice(source.indexOf('async function importOrchestratorWorkerPlanBundle('), source.indexOf('\n// Legacy per-task JSON artifact') + 1) || source.slice(source.indexOf('async function importOrchestratorWorkerPlanBundle('))
  assert.match(upload.slice(0, 900), /orchestrator\/plans\/import-bundle/)
  assert.match(upload.slice(0, 900), /'Content-Type': 'application\/zip'/)
  assert.doesNotMatch(worker, /JSZip|unzip|inflate/i)

  const instruction = source.slice(source.indexOf('function orchestratorPlanInstruction('), source.indexOf('\n// Validate and import one orchestrator plan artifact'))
  assert.match(instruction, /BUNDLE ONLY/)
  assert.match(instruction, /single UTF-8 entry named exactly plan\.json/)
})

test('orchestrator planning carries shared-composer context and attachments into ChatGPT', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeChatAgentOrchestratorPlan(')
  const worker = source.slice(start, source.indexOf('\nasync function executeChatAgentMarkdownTranslation', start))

  assert.match(worker, /const includeContext = payload\.include_context === true/)
  assert.match(worker, /storedAttachmentPath\(chatAttachmentRoot\(\), String\(attachment\?\.storage_ref \|\| ''\)\)/)
  assert.match(worker, /const context = await fetchContextZip\(sessionId\)/)
  assert.match(worker, /await pasteChatGPTFile\(target\.entry, uploadPaths\[index\], index \+ 1, uploadPaths\.length\)/)
  assert.match(worker, /removeStoredChatAttachments\(chatAttachmentRoot\(\), attachmentCacheKey\)/)
})

test('a Supervisor or Worker whose sticky error clears on the next successful (even empty) claim', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

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

test('retrying a prepared ChatGPT prompt recognizes an already-delivered response before consulting a stale retryable draft', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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

test('scaling the Supervisor pool reaches the Supervisor scheduler, not the Worker one', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function setChatAgentSupervisorTarget(')
  const fn = source.slice(start, source.indexOf('\nfunction chatAgentAvailableSupervisors', start))

  // Each pool owns one claim loop per slot, and the count has to reach the
  // scheduler that runs those loops. Sending the Supervisor count to
  // chatAgentScheduler left the Supervisor pool frozen at its construction
  // count — neither the operator's stepper nor Auto scale could add one — while
  // silently resizing the Worker pool to the Supervisor number.
  assert.match(fn, /chatSupervisorScheduler\?\.setSupervisorCount\(normalized\)/)
  assert.doesNotMatch(fn, /chatAgentScheduler\?\.setSupervisorCount/)

  const workerStart = source.indexOf('function setChatAgentWorkerTarget(')
  const workerFn = source.slice(workerStart, source.indexOf('\nasync function reconcileChatAgentAutoScale', workerStart))
  assert.match(workerFn, /chatAgentScheduler\?\.setWorkerCount\(normalized\)/)
})

test('auto scale sizes each pool from its own half of the backlog', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function reconcileChatAgentAutoScale(')
  const fn = source.slice(start, source.indexOf('\nfunction reconcileChatGPTWorkerPool', start))

  // The two pools own disjoint task types, so the shared `due` total describes
  // neither: it would grow the Supervisors because a library cleanup is queued
  // and grow the Workers because a conversation is being supervised.
  assert.match(fn, /reconcileChatAgentSupervisorAutoScale\(queue\)/)
  assert.match(fn, /autoScaleTarget\(\{\s*enabled: true, due: queue\.due_worker/)
  assert.doesNotMatch(fn, /due: queue\.due,/)

  const supervisorStart = source.indexOf('function reconcileChatAgentSupervisorAutoScale(')
  const supervisor = source.slice(supervisorStart, source.indexOf('\nfunction reconcileChatGPTWorkerPool', supervisorStart))
  assert.match(supervisor, /dueLanes: queue\.due_supervisor_lanes/)
  assert.match(supervisor, /maxSupervisors: chatAgentPolicies\.auto_scale_max_supervisors/)
  assert.match(supervisor, /setChatAgentSupervisorTarget\(grow\)/)
})

test('a settling bundle delivery stands the supervision back at the observation cadence', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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

test('a Worker that finds a Supervisor already supervising stands back at the observation cadence', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
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

test('a held Supervisor reports as occupied rather than as available between observations', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function chatAgentRuntimeState()')
  const fn = source.slice(start, source.indexOf('\nfunction publishChatAgentRuntimeState', start))

  // Supervision spends almost all of its life between observations with the
  // lease handed back. Deriving the status from the lease alone painted a slot
  // that is demonstrably mid-request as free on every cycle.
  assert.match(fn, /: hold \? 'claimed'\s*\n\s*: entry \? 'idle' : 'stopped'/)
  assert.match(fn, /occupied: Boolean\(own\.task \|\| hold\)/)
  assert.match(fn, /project_id: chatAgentAgentProject\(own\.task, own\.lastTask, Boolean\(hold\)\)/)
})

// harness_chat_agent_tasks showed 124/124 RENAME_CHAT/ARCHIVE_CHAT/
// DELETE_TEMP_CHAT attempts failing with last_error 'menu-not-open' since
// 2026-09-15, every task-level retry (up to 8 attempts) hitting the identical
// outcome: the trigger was clicked exactly once and only the menu-item lookup
// was ever retried, so a menu that failed to render on that single click could
// never be reopened.
test('a conversation menu that fails to render is reopened before the action gives up', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function chooseChatGPTConversationAction(')
  assert.notEqual(start, -1)
  const fn = source.slice(start, source.indexOf('\n}', start) + 2)

  assert.match(fn, /for \(let attempt = 0; attempt < CHATGPT_MENU_REOPEN_ATTEMPTS; attempt \+= 1\)/)
  const loopStart = fn.indexOf('for (')
  const loop = fn.slice(loopStart, fn.indexOf('\n  }', loopStart))
  assert.match(loop, /chatGPTOpenConversationMenuScript\(conversationId\)/)
  assert.match(loop, /if \(!opened\.ok\) return opened/)
  assert.match(loop, /if \(located\.state !== 'menu-not-open'\) return located/)
})

// primeChatGPTWorkerPool called an undefined `delay`, which threw as an
// unhandled rejection after creating exactly one worker slot - captured live
// in .harness/logs/desktop.log - silently abandoning the paced startup
// priming loop for every slot after the first.
test('primeChatGPTWorkerPool paces worker creation with a defined helper', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function primeChatGPTWorkerPool(')
  assert.notEqual(start, -1)
  const fn = source.slice(start, source.indexOf('\n}', start) + 2)

  assert.match(fn, /await wait\(CHAT_AGENT_WORKER_SPAWN_GAP_MS\)/)
  assert.doesNotMatch(fn, /await delay\(/)
})

// Clicking the result-download control on every poll tick fired a real
// ChatGPT download each time a tick elapsed before will-download resolved
// the previous one, and the browser's own duplicate-name suffix on the
// later downloads was not recognised by the strict exact-filename match in
// registerChatGPTTodoClassificationDownload/registerChatGPTMarkdownTranslationDownload,
// so those extra downloads fell through to a native, undismissable OS save
// dialog - live-observed as the desktop UI becoming unresponsive.
test('the TODO classification and translation download loops click at most once per response', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  for (const [open, close] of [
    ['async function executeChatAgentTodoClassification(', '\nasync function chatAgentLifecycleRetry'],
    ['async function executeChatAgentMarkdownTranslation(', '\nasync function executeChatAgentTodoClassification'],
  ]) {
    const start = source.indexOf(open)
    assert.notEqual(start, -1, open)
    const fn = source.slice(start, source.indexOf(close, start))
    assert.match(fn, /let downloadTriggered = false/, open)
    assert.match(fn, /if \(!downloadTriggered && Number\(completion\?\.assistantCount \|\| 0\) > assistantBaseline\)/, open)
    assert.match(fn, /if \(clicked\) downloadTriggered = true/, open)
  }
})

test('the TODO classification and translation flows reassert composer text before submitting', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  for (const [open, close] of [
    ['async function executeChatAgentTodoClassification(', '\nasync function chatAgentLifecycleRetry'],
    ['async function executeChatAgentMarkdownTranslation(', '\nasync function executeChatAgentTodoClassification'],
  ]) {
    const start = source.indexOf(open)
    assert.notEqual(start, -1, open)
    const fn = source.slice(start, source.indexOf(close, start))
    const fillCount = (fn.match(/chatGPTFillComposerScript\(bootstrap\)/g) || []).length
    assert.equal(fillCount, 2, `${open} must fill the composer once and reassert it once before submit`)
    const refillIndex = fn.lastIndexOf('chatGPTFillComposerScript(bootstrap)')
    const submitIndex = fn.indexOf('submitChatGPTDraft(')
    assert.ok(refillIndex < submitIndex, `${open} must reassert composer text before submitting`)
  }
})

test('registerChatGPTTodoClassificationDownload and registerChatGPTMarkdownTranslationDownload tolerate a browser duplicate-name suffix', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  for (const [open, close] of [
    ['function registerChatGPTTodoClassificationDownload(', '\nfunction orchestratorPlanInboxDirectory'],
    ['function registerChatGPTMarkdownTranslationDownload(', '\nfunction registerChatGPTOrchestratorPlanDownload'],
  ]) {
    const start = source.indexOf(open)
    assert.notEqual(start, -1, open)
    const fn = source.slice(start, source.indexOf(close, start))
    assert.match(fn, /stripChatGPTDownloadDuplicateSuffix\(rawFilename\)/, open)
  }
  const helperStart = source.indexOf('function stripChatGPTDownloadDuplicateSuffix(')
  assert.notEqual(helperStart, -1)
  const helper = source.slice(helperStart, source.indexOf('\n}', helperStart))
  assert.match(helper, /\[1-9\]\[0-9\]\{0,3\}/)
})

// Clearing the whole ChatGPT session cache on every startup forced every
// Supervisor/Worker to refetch ChatGPT's entire SPA bundle over the network
// on the very next navigation instead of using the warm disk cache - a large,
// entirely avoidable share of what made ordinary restarts feel heavy. The
// clear only guards against a UA that changed since the marker was written.
test('the ChatGPT cache is only cleared when the spoofed Chromium UA has changed since last run', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('app.whenReady().then(async () => {')
  assert.notEqual(start, -1)
  const boot = source.slice(start, source.indexOf('\n  const layout = loadWindowLayout()', start))

  assert.match(boot, /if \(!chatGPTCacheMarkerCurrent\(\)\) \{/)
  const guardStart = boot.indexOf('if (!chatGPTCacheMarkerCurrent())')
  const guard = boot.slice(guardStart, boot.indexOf('\n  }', guardStart))
  assert.match(guard, /await chatSession\.clearCache\(\)/)
  assert.match(guard, /writeChatGPTCacheMarker\(\)/)

  const helperStart = source.indexOf('function chatGPTCacheMarkerCurrent(')
  assert.notEqual(helperStart, -1)
  const helper = source.slice(helperStart, source.indexOf('\n}', helperStart))
  assert.match(helper, /chromiumVersion === CHATGPT_CHROMIUM_VERSION/)
})

// Live-observed on a large draining backlog: due-task demand flapped above
// and below zero from one 2s auto-scale poll to the next, so a grow was torn
// back down before its own demand's next tick, then regrown moments later -
// each cycle creating and destroying real WebContentsViews (a navigation to
// chatgpt.com apiece). That churn was severe enough to crash the desktop.
// Both pools must hold a recent grow for a cooldown window before a drain on
// the same tick shape is allowed to act.
test('the worker and supervisor pools cannot drain immediately after growing', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

  const workerStart = source.indexOf('async function reconcileChatAgentAutoScale(')
  assert.notEqual(workerStart, -1)
  const worker = source.slice(workerStart, source.indexOf('\n// Auto scale for the Supervisor pool.', workerStart))
  assert.match(worker, /chatAgentWorkerLastGrowAt = Date\.now\(\)/)
  const workerGrowIndex = worker.indexOf('chatAgentWorkerLastGrowAt = Date.now()')
  const workerCooldownIndex = worker.indexOf('Date.now() - chatAgentWorkerLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS')
  assert.notEqual(workerCooldownIndex, -1)
  assert.ok(workerGrowIndex < workerCooldownIndex, 'worker grow must be recorded before the cooldown check')
  const workerDrainIndex = worker.indexOf('autoScaleDrainTarget(')
  assert.ok(workerCooldownIndex < workerDrainIndex, 'worker cooldown must gate the drain check')

  const supervisorStart = source.indexOf('function reconcileChatAgentSupervisorAutoScale(')
  assert.notEqual(supervisorStart, -1)
  const supervisor = source.slice(supervisorStart, source.indexOf('\nfunction reconcileChatGPTWorkerPool(', supervisorStart))
  assert.match(supervisor, /chatAgentSupervisorLastGrowAt = Date\.now\(\)/)
  const supervisorCooldownIndex = supervisor.indexOf('Date.now() - chatAgentSupervisorLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS')
  assert.notEqual(supervisorCooldownIndex, -1)
  const supervisorDrainIndex = supervisor.indexOf('autoScaleSupervisorDrainTarget(')
  assert.ok(supervisorCooldownIndex < supervisorDrainIndex, 'supervisor cooldown must gate the drain check')
})
