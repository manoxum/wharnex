import { readPromptTransportSource } from '../transport/prompt-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readDesktopCompositionSource } from '../entry/source.mjs'


test('internal ChatGPT browser reuses the isolated Electron partition without privileged preload', async () => {
  const [source, browserRuntime, internalBrowser, authIPC, preload, cleanup] = await Promise.all([
    readPromptTransportSource(),
    readFile(new URL('../browser/runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../browser/session/internal-window.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../chatgpt/session/ipc/authentication.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../../chatgpt/session/views/cleanup.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(await readDesktopCompositionSource(), /compose\(ctx, 'entrypoint', \(deps\) => \(\{ desktopEntrypoint: createDesktopEntrypointRuntime\(deps\) \}\)/)
  assert.match(browserRuntime, /const openInternalChatGPTBrowser = createInternalChatGPTBrowser\(\{/)
  assert.match(browserRuntime, /partition: d\.CHATGPT_PARTITION/)
  assert.match(internalBrowser, /new BrowserWindow/)
  assert.match(internalBrowser, /securePreferences\(\{ partition, backgroundThrottling: false \}\)/)
  assert.doesNotMatch(internalBrowser, /preload:/)
  assert.match(browserRuntime, /trustedURL: d\.requireTrustedChatGPTURL/)
  assert.match(internalBrowser, /trustedURL\(value \|\| homeURL\)/)
  assert.match(internalBrowser, /setWindowOpenHandler/)
  assert.match(internalBrowser, /will-navigate/)
  assert.match(source, /registerChatGPTSessionControlIPC\(\{/)
  assert.match(authIPC, /ipcMain\.handle\('wharness:chatgpt:open-internal'/)
  assert.match(browserRuntime, /closeInternalBrowsers: d\.closeAllInternalChatGPTBrowsers/)
  assert.match(cleanup, /function closeAllInternalChatGPTBrowsers\(\)/)
  assert.match(preload, /openInternal: \(url = ''\) => invoke\('wharness:chatgpt:open-internal'/)
})

test('dual ChatGPT auth uses a real managed browser and never forwards an in-flight provider URL', async () => {
  const source = await readPromptTransportSource()
  const authViewRuntime = await readFile(new URL('./auth-view/runtime.mjs', import.meta.url), 'utf8')
  const navigation = await readFile(new URL('../../chatgpt/session/auth/navigation.mjs', import.meta.url), 'utf8')
  const managed = await readFile(new URL('../../chatgpt/session/auth/managed.mjs', import.meta.url), 'utf8')
  const routeStart = navigation.indexOf('function routeChatGPTNavigation(entry, event, url)')
  const routeEnd = navigation.length
  assert.notEqual(routeStart, -1)
  assert.notEqual(routeEnd, -1)
  const route = navigation.slice(routeStart, routeEnd)
  assert.match(source, /compose\(ctx, 'auth-views', createDesktopAuthViewRuntime, \{/)
  assert.match(authViewRuntime, /createChatGPTAuthentication\(\{/)
  assert.match(route, /startExternalAuthentication\(entry, disposition\.provider \|\| 'OpenAI'\)/)
  assert.match(route, /disposition\.provider === 'Google'/)
  assert.doesNotMatch(route, /shell\.openExternal\(url\).*external-auth/s)

  const externalStart = managed.indexOf('function startExternalAuthentication(entry, provider')
  const externalEnd = managed.indexOf('\n  return { cancelExternalAuthentication', externalStart)
  const externalAuth = managed.slice(externalStart, externalEnd)
  assert.match(externalAuth, /launchManagedBrowserAuth/)
  assert.match(source, /loginURL: CHATGPT_LOGIN_URL/)
  assert.match(externalAuth, /launchManagedBrowserAuth\(\{\s*profileDir,\s*loginURL,/)
  assert.doesNotMatch(externalAuth, /new BrowserWindow/)
})

test('external auth reuses the persistent Wharnex browser profile and clear-session owns deletion', async () => {
  const source = await readPromptTransportSource()
  const browserRuntime = await readFile(new URL('../browser/runtime.mjs', import.meta.url), 'utf8')
  const managed = await readFile(new URL('../../chatgpt/session/auth/managed.mjs', import.meta.url), 'utf8')
  const browserSession = await readFile(new URL('../../browser/session/session-operations.mjs', import.meta.url), 'utf8')
  const externalStart = managed.indexOf('function startExternalAuthentication(entry, provider')
  const externalEnd = managed.indexOf('\n  return { cancelExternalAuthentication', externalStart)
  assert.notEqual(externalStart, -1)
  assert.notEqual(externalEnd, -1)
  const externalAuth = managed.slice(externalStart, externalEnd)
  assert.match(externalAuth, /const profileDir = managedAuthProfilePath\(\)/)
  assert.doesNotMatch(externalAuth, /app\.getPath\('temp'\)/)
  assert.doesNotMatch(externalAuth, /rm\(record\.profileDir/)

  const clearStart = browserSession.indexOf('async function clearSession()')
  const clearEnd = browserSession.indexOf('\n  async function storageUsage', clearStart)
  assert.notEqual(clearStart, -1)
  assert.notEqual(clearEnd, -1)
  assert.match(browserSession.slice(clearStart, clearEnd), /rm\(authProfilePath\(\), \{ recursive: true, force: true/)
  assert.match(await readDesktopCompositionSource(), /compose\(ctx, 'entrypoint', \(deps\) => \(\{ desktopEntrypoint: createDesktopEntrypointRuntime\(deps\) \}\)/)
  assert.match(browserRuntime, /authProfilePath: d\.managedAuthProfilePath/)
})


test('desktop owns the new-chat affinity handshake and renderer only confirms or rejects its candidate', async () => {
  const source = await readPromptTransportSource()
  const navigation = await readFile(new URL('../../chatgpt/session/ipc/navigation.mjs', import.meta.url), 'utf8')
  const viewSupervisor = await readFile(new URL('../../chatgpt/session/views/supervisor.mjs', import.meta.url), 'utf8')
  const viewState = await readFile(new URL('../../chatgpt/session/views/state.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatGPTViewState\(\{/)
  assert.match(viewState, /\.\.\.publicChatGPTAffinity\(entry\?\.affinity\)/)
  assert.match(viewSupervisor, /observeChatGPTAffinityURL\(cacheKey, entry, url\)/)
  assert.match(source, /registerChatGPTSurfaceIPC\(\{/)
  assert.match(navigation, /syncChatGPTAffinityURL\(key, entry, linkedConversation\)/)
  assert.match(navigation, /wharness:chatgpt:confirm-affinity/)
  assert.match(navigation, /confirmChatGPTAffinity\(entry\.affinity, request\?\.conversationUrl, wc\.getURL\(\)\)/)
  assert.match(navigation, /wharness:chatgpt:reject-affinity/)
  assert.match(navigation, /rejectChatGPTAffinity\(entry\.affinity, rejectedURL\)/)
  assert.match(source, /markChatGPTAffinitySubmitted\(target\.entry\.affinity\)/)
  const prepareStart = source.indexOf('async function preparePromptForChatGPT(request, entryOverride = undefined, { pacedWorker = false } = {})')
  const prepareEnd = source.indexOf('\nasync function attachContextToChatGPT', prepareStart)
  const prepare = source.slice(prepareStart, prepareEnd)
  assert.match(prepare, /linkedConversation \|\| CHATGPT_URL/)
  assert.match(prepare, /syncChatGPTAffinityURL\(key, target\.entry\)/)
})

test('ChatGPT affinity state is published to the owner window even when another chat is visually active', async () => {
  const source = await readPromptTransportSource()
  const state = await readFile(new URL('../../chatgpt/session/views/state.mjs', import.meta.url), 'utf8')
  const publishStart = state.indexOf('function publishChatGPTState')
  const publishEnd = state.indexOf('\n  return { setChatGPTBounds', publishStart)
  const publish = state.slice(publishStart, publishEnd)
  assert.match(source, /createChatGPTViewState\(\{/)
  assert.match(publish, /windowStateForEntry\(entry\)/)
  assert.match(publish, /sendToWindowState\(state, 'wharness:chatgpt:state'/)
  assert.doesNotMatch(publish, /state\.activeChatGPTKey !== key/)
})


test('same-origin ChatGPT auth redirects stay embedded and explicit loads are serialized', async () => {
  const source = await readPromptTransportSource()
  const navigation = await readFile(new URL('../../chatgpt/session/auth/navigation.mjs', import.meta.url), 'utf8')
  const viewNavigation = await readFile(new URL('../../chatgpt/session/views/navigation.mjs', import.meta.url), 'utf8')
  const viewSupervisor = await readFile(new URL('../../chatgpt/session/views/supervisor.mjs', import.meta.url), 'utf8')
  const viewEntry = await readFile(new URL('../../chatgpt/session/views/entry.mjs', import.meta.url), 'utf8')
  const authViewRuntime = await readFile(new URL('./auth-view/runtime.mjs', import.meta.url), 'utf8')
  const routeStart = navigation.indexOf('function routeChatGPTNavigation')
  const route = navigation.slice(routeStart)
  assert.match(source, /compose\(ctx, 'auth-views', createDesktopAuthViewRuntime, \{/)
  assert.match(authViewRuntime, /createChatGPTAuthentication\(\{/)
  assert.match(route, /disposition\.kind === 'chatgpt-auth'/)
  const authStart = route.indexOf("disposition.kind === 'chatgpt-auth'")
  const externalStart = route.indexOf("disposition.kind === 'external-auth'", authStart)
  const authBlock = route.slice(authStart, externalStart)
  assert.match(authBlock, /entry\.embeddedAuthActive = true/)
  assert.doesNotMatch(authBlock, /startExternalAuthentication/)

  assert.match(authViewRuntime, /createChatGPTViewOperations\(\{/)
  const load = viewNavigation
  assert.match(load, /entry\.navigationPromise/)
  assert.match(load, /isBenignChatGPTLoadAbort/)
  assert.match(load, /await withChatGPTNavigationDeadline\([\s\S]*\(\) => wc\.loadURL\(target/)

  assert.match(viewSupervisor, /createChatGPTViewEntry\(view, cacheKey, windowState\.id/)
  assert.match(viewEntry, /authMode: 'embedded'/)
})

test('desktop ChatGPT state publishes only a boolean authentication result to the renderer', async () => {
  const source = await readPromptTransportSource()
  const authViewRuntime = await readFile(new URL('./auth-view/runtime.mjs', import.meta.url), 'utf8')
  const viewState = await readFile(new URL('../../chatgpt/session/views/state.mjs', import.meta.url), 'utf8')
  const embedded = await readFile(new URL('../../chatgpt/session/auth/embedded.mjs', import.meta.url), 'utf8')
  assert.match(source, /createChatGPTViewState\(\{/)
  assert.match(viewState, /authenticated: Boolean\(entry\?\.authenticated\)/)
  assert.match(source, /compose\(ctx, 'auth-views', createDesktopAuthViewRuntime, \{/)
  assert.match(authViewRuntime, /createEmbeddedChatGPTAuthentication\(\{/)
  assert.match(embedded, /executeJavaScript\(chatGPTSessionProbeExpression\(\), true\)/)
})

// Moving a conversation into a ChatGPT project — which the account automation
// does deliberately — changes its URL to `/g/g-p-<project>/c/<id>`. Matching
// only the root `/c/<id>` form silently unbound the chat's affinity and left
// account operations unable to address the conversation by id, which surfaces
// to the user as `menu-unavailable`.
test('conversation ids are recovered from project-scoped conversation URLs', async () => {
  const source = await readFile(new URL('../../chatgpt/session/conversation-url.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function conversationID(value)')
  const end = source.indexOf('\n  function canonicalURL', start)
  assert.notEqual(start, -1)
  const body = source.slice(start, end)
  assert.match(body, /\(\?:\^\|\\\/\)c\\\/\(\[\^\/\?#\]\+\)/)
  assert.doesNotMatch(body, /\/\^\\\/c\\\//)
  // Transient creation URLs (`WEB:…`, `local-chatgpt:…`) never become durable
  // affinity: only the durable id charset is accepted.
  assert.match(body, /\^\[A-Za-z0-9-\]\{1,128\}\$/)
})
