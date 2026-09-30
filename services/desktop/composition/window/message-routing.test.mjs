import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createDesktopMessageRouting } from './message-routing.mjs'

test('routes only trusted window and owned ChatGPT entry messages', () => {
  const messages = []
  const state = {
    id: 'window-1', activeChatGPTKey: 'chat-1',
    window: { isDestroyed: () => false, webContents: { id: 7, send: (...args) => messages.push(args) } },
  }
  const entry = { ownerWindowId: state.id, view: { isVisible: () => true } }
  const routing = createDesktopMessageRouting({
    desktopWindows: new Map([[state.id, state]]),
    chatgptViews: new Map([['chat-1', entry]]),
  })

  assert.equal(routing.trustedSender({ sender: { id: 7 } }), state)
  assert.throws(() => routing.trustedSender({ sender: { id: 8 } }), /Untrusted IPC sender/)
  assert.equal(routing.activeChatGPTEntry(), entry)
  routing.publishChatGPTAccountAction('chat-1', 'rename', { ok: true, state: 'done' })
  assert.deepEqual(messages, [['wharness:chatgpt:account-action', {
    cacheKey: 'chat-1', action: 'rename', ok: true, state: 'done', provider: 'typed-browser',
  }]])
  routing.sendToChatGPTKey('unknown', 'ignored', {})
  assert.equal(messages.length, 1)
  state.window.isDestroyed = () => true
  routing.sendToWindowState(state, 'ignored', {})
  assert.equal(messages.length, 1)
})

test('runtime controls defer message routing until after the routing factory initializes', async () => {
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const controls = main.indexOf('createChatAgentRuntimeControls({')
  const routing = main.indexOf('createDesktopMessageRouting({')
  assert.ok(controls >= 0 && routing > controls)
  assert.match(main.slice(controls, routing), /sendToWindowState: \(\.\.\.args\) => sendToWindowState\(\.\.\.args\)/)
})
