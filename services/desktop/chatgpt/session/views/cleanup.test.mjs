import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTViewCleanup } from './cleanup.mjs'

function cleanupFixture() {
  const calls = []
  const browser = { isDestroyed: () => false, close: () => calls.push('browser closed') }
  const supervisor = { ownerWindowId: 'closing', view: { webContents: browser } }
  const worker = {
    ownerWindowId: 'closing', interactionWindowId: 'closing',
    view: { webContents: browser },
  }
  const closing = {
    id: 'closing', activeChatGPTKey: 'chat', chatgptVisible: true,
    window: { contentView: { removeChildView: () => calls.push('detached') } },
  }
  const replacement = {
    id: 'replacement', window: {
      isDestroyed: () => false,
      contentView: { addChildView: () => calls.push('attached') },
    },
  }
  const internalChatGPTBrowsers = new Map([['closing', browser]])
  const chatGPTAuthBrowsers = new Map()
  const chatgptViews = new Map([['chat', supervisor]])
  const chatGPTWorkerEntries = [worker]
  const desktopWindows = new Map([['closing', closing], ['replacement', replacement]])
  const cleanup = createChatGPTViewCleanup({
    internalChatGPTBrowsers, chatGPTAuthBrowsers, chatgptViews,
    chatGPTWorkerEntries, desktopWindows,
    hideChatAgentInteractionsForWindow: () => calls.push('interaction hidden'),
    retireChatGPTSupervisorSurface: (key) => { calls.push(`retired ${key}`); chatgptViews.delete(key) },
    closeManagedBrowserAuth: () => {},
  })
  return { cleanup, calls, browser, worker, closing, internalChatGPTBrowsers, chatgptViews, chatGPTWorkerEntries }
}

test('re-homing a Worker moves only its ownership; the real view stays in the browser host', () => {
  const { cleanup, calls, worker, closing } = cleanupFixture()
  assert.equal(cleanup.rehomeChatGPTWorkers(closing), true)
  assert.deepEqual(calls, ['interaction hidden'])
  assert.equal(worker.ownerWindowId, 'replacement')
  assert.equal(worker.interactionWindowId, '')
})

test('window and session cleanup releases owned views and preserves the shared map identity', () => {
  const { cleanup, calls, closing, internalChatGPTBrowsers, chatgptViews, chatGPTWorkerEntries } = cleanupFixture()
  cleanup.closeChatGPTViewsForWindow(closing)
  assert.deepEqual(calls, ['retired chat'])
  assert.equal(closing.activeChatGPTKey, '')
  assert.equal(closing.chatgptVisible, false)
  assert.equal(cleanup.closeInternalChatGPTBrowserForWindow(closing), true)
  assert.equal(internalChatGPTBrowsers.size, 0)
  chatgptViews.set('chat', { view: { webContents: { isDestroyed: () => false, close: () => calls.push('supervisor closed') } } })
  cleanup.closeAllChatGPTViews()
  assert.equal(chatgptViews.size, 0)
  assert.equal(chatGPTWorkerEntries.length, 0)
  assert.ok(calls.includes('supervisor closed'))
  assert.ok(calls.includes('browser closed'))
})
