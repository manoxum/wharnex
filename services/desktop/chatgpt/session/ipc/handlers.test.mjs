import assert from 'node:assert/strict'
import test from 'node:test'
import { registerChatGPTNavigationIPC } from './navigation.mjs'
import { registerChatGPTStateIPC } from './state.mjs'
import { registerChatGPTVisibilityIPC } from './visibility.mjs'

function handlers() {
  const entries = new Map()
  return { entries, ipcMain: { handle: (name, handler) => entries.set(name, handler) } }
}

test('a foreign window cannot open a ChatGPT view devtools', () => {
  const { entries, ipcMain } = handlers()
  let opened = 0
  const entry = {
    ownerWindowId: 'owner',
    view: { webContents: { openDevTools: () => { opened++ } } },
  }
  registerChatGPTStateIPC({
    ipcMain,
    trustedSender: (event) => ({ id: event.id }),
    sanitizeChatCacheKey: (key) => key,
    chatgptViews: new Map([['chat', entry]]),
    requireOwnedChatGPTEntry: () => ({ wc: entry.view.webContents }),
  })
  const open = entries.get('wharness:chatgpt:open-devtools')
  assert.throws(() => open({ id: 'foreign' }, { cacheKey: 'chat' }), /not available/)
  assert.equal(opened, 0)
  assert.deepEqual(open({ id: 'owner' }, { cacheKey: 'chat' }), { ok: true })
  assert.equal(opened, 1)
})

test('show owns the initial trusted navigation and bounds require active visibility', async () => {
  const { entries, ipcMain } = handlers()
  const windowState = { id: 'owner', activeChatGPTKey: 'chat', chatgptVisible: false }
  const loads = []
  const entry = { view: { webContents: { getURL: () => 'about:blank' } } }
  registerChatGPTVisibilityIPC({
    ipcMain, trustedSender: () => windowState,
    deferSupervisorNavigationIfBusy: () => false,
    activateChatGPTView: () => entry,
    requireTrustedChatGPTURL: (url) => url,
    homeURL: 'https://chatgpt.com/',
    isTrustedChatGPTOrigin: (url) => url.startsWith('https://chatgpt.com/'),
    loadOwnedChatGPTURL: async (...args) => { loads.push(args) },
    sanitizeChatCacheKey: (key) => key,
    waitForChatGPTSurfaceReady: async () => undefined,
    chatgptViews: new Map(),
    getDeferredSupervisorNavigation: () => undefined,
    setChatGPTBounds: () => true,
  })
  const bounds = entries.get('wharness:chatgpt:set-bounds')
  assert.deepEqual(bounds({}, { cacheKey: 'chat' }), { ok: false })
  assert.deepEqual(await entries.get('wharness:chatgpt:show')({}, { cacheKey: 'chat' }), { ok: true })
  assert.deepEqual(loads, [['chat', entry, 'https://chatgpt.com/', 'initial-show']])
  assert.deepEqual(bounds({}, { cacheKey: 'chat' }), { ok: true })
  assert.deepEqual(bounds({}, { cacheKey: 'foreign' }), { ok: false })
})

test('a busy Supervisor defers navigation without activating a different view', async () => {
  const { entries, ipcMain } = handlers()
  const windowState = { id: 'owner' }
  registerChatGPTNavigationIPC({
    ipcMain, trustedSender: () => windowState,
    sanitizeChatCacheKey: (key) => key,
    requireTrustedChatGPTURL: (url) => url,
    homeURL: 'https://chatgpt.com/',
    deferSupervisorNavigationIfBusy: () => true,
    currentChatGPTState: (key) => ({ cacheKey: key, deferred: true }),
    activateChatGPTView: () => assert.fail('busy navigation must not activate another view'),
  })
  assert.deepEqual(
    await entries.get('wharness:chatgpt:navigate')({}, { cacheKey: 'chat', url: 'https://chatgpt.com/c/id' }),
    { cacheKey: 'chat', deferred: true },
  )
})
