import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopChatGPTModels } from './runtime.mjs'
import { registerChatGPTModelIPC } from './ipc.mjs'

function fixture(directory) {
  const entry = { ownerKey: 'chat', view: { webContents: { getURL: () => 'https://chatgpt.com/c/owned' } }, conversationRequests: new Map() }
  const events = []
  const d = { app: { getPath: () => directory }, sanitizeChatCacheKey: (value) => value,
    ensureChatGPTView: () => ({ entry }), requireOwnedChatGPTEntry: () => ({ wc: entry.view.webContents }),
    isTrustedChatGPTOrigin: () => true, chatgptTransportModes: new Map(), expectedChatGPTBundles: new Map(),
    preparedChatGPTDrafts: new Map(), retryableChatGPTPrompts: new Map(), pendingChatGPTComments: new Map(),
    withChatGPTTransportPreparation: async (_key, _entry, _id, operation) => { entry.transportPreparationCount = 1; try { return await operation() } finally { entry.transportPreparationCount = 0 } },
    executeChatGPTDOMScript: async () => { events.push('DOM'); return { ok: true, state: 'model-menu-read', options: [{ id: 'alpha', label: 'Account Alpha', selected: true, disabled: false }] } },
    pressChatGPTControlKey: async () => {}, wait: async () => {},
  }
  return { d, entry, events, api: createDesktopChatGPTModels(d) }
}

test('UI inventory refuses manual, active generation, queued drafts and external login before DOM reads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wharnex-model-guard-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const guards = [(f) => f.d.chatgptTransportModes.set('chat', 'manual'), (f) => f.d.expectedChatGPTBundles.set('chat', {}), (f) => f.d.preparedChatGPTDrafts.set('chat', {}), (f) => { f.entry.externalAuthProvider = 'oauth' }, (f) => { f.entry.transportPreparationCount = 1 }]
  for (const guard of guards) {
    const f = fixture(directory)
    guard(f)
    await assert.rejects(f.api.getChatGPTModels({ workspaceChatId: 'chat' }), /escolha de modelo/)
    assert.deepEqual(f.events, [])
  }
})

test('successful inventory is read-only and only a confirmed setter persists a preference', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wharnex-model-runtime-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const f = fixture(directory)
  assert.equal((await f.api.getChatGPTModels({ workspaceChatId: 'chat' })).current, 'alpha')
  assert.equal(await f.api.ensureSelectedChatGPTModel('chat', f.entry), undefined)
  await f.api.setChatGPTModel({ workspaceChatId: 'chat', model: 'alpha' })
  assert.equal((await fixture(directory).api.ensureSelectedChatGPTModel('chat', f.entry)).current, 'alpha')
})

test('model IPC requires the trusted window before forwarding a narrow request', async () => {
  const handlers = new Map()
  const seen = []
  registerChatGPTModelIPC({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, trustedSender: (event) => { if (!event.trusted) throw new Error('untrusted'); return { id: 'window' } }, getChatGPTModels: async (request, state) => seen.push([request, state]), setChatGPTModel: async () => {} })
  await assert.rejects(handlers.get('wharnex:chatgpt:get-models')({}, { workspaceChatId: 'chat' }), /untrusted/)
  assert.deepEqual(seen, [])
  await handlers.get('wharnex:chatgpt:get-models')({ trusted: true }, { workspaceChatId: 'chat' })
  assert.deepEqual(seen, [[{ workspaceChatId: 'chat' }, { id: 'window' }]])
})

test('an explicit chooser action initializes only a blank owned surface and never retargets a loaded conversation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wharnex-model-initialize-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const f = fixture(directory)
  let url = 'about:blank'
  f.entry.view.webContents.getURL = () => url
  Object.assign(f.d, { CHATGPT_URL: 'https://chatgpt.com/', loadOwnedChatGPTURL: async (_key, _entry, desired) => { f.events.push('owned-navigation'); url = desired }, waitForChatGPTSurfaceReady: async () => {}, requireTrustedChatGPTURL: (value) => value, canonicalChatGPTConversationURL: (value) => value, sameConversationURL: (left, right) => left === right })
  await f.api.getChatGPTModels({ workspaceChatId: 'chat', url: 'https://chatgpt.com/c/owned' })
  assert.equal(url, 'https://chatgpt.com/c/owned')
  assert.equal(f.events.filter((event) => event === 'owned-navigation').length, 1)
  f.events.length = 0
  await assert.rejects(f.api.getChatGPTModels({ workspaceChatId: 'chat', url: 'https://chatgpt.com/c/different' }), /conversa do Engine mudou/)
  assert.deepEqual(f.events, [])
})
