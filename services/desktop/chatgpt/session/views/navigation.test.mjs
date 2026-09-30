import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTViewNavigation } from './navigation.mjs'

function navigationHarness() {
  let currentURL = 'about:blank'
  let finishLoad
  const loads = []
  const wc = {
    isDestroyed: () => false,
    isLoading: () => false,
    getURL: () => currentURL,
    loadURL: (url) => new Promise((resolve) => {
      loads.push(url)
      finishLoad = () => { currentURL = url; resolve() }
    }),
    stop: () => undefined,
  }
  const entry = { navigationPromise: undefined, navigationTarget: '' }
  const { loadOwnedChatGPTURL } = createChatGPTViewNavigation({
    sanitizeChatCacheKey: (key) => key,
    requireTrustedChatGPTURL: (url) => {
      if (!url.startsWith('https://chatgpt.com/')) throw new Error('untrusted URL')
      return url
    },
    requireOwnedChatGPTEntry: (_key, owned) => {
      if (owned !== entry) throw new Error('foreign entry')
      return { wc }
    },
    sameConversationURL: (left, right) => left === right,
    currentChatGPTState: () => ({ ok: true }),
    windowStateForEntry: () => ({}),
    chatAgentWorkerActivity: { set: () => undefined },
    sanitizeDiagnosticURL: (url) => url,
    withChatGPTNavigationDeadline: (load) => load(),
    userAgent: 'test-agent', wait: async () => undefined,
    isTrustedChatGPTOrigin: (url) => url.startsWith('https://chatgpt.com/'),
  })
  return { entry, loads, loadOwnedChatGPTURL, finish: () => finishLoad() }
}

test('owned navigation coalesces the same target and clears its in-flight marker', async () => {
  const { entry, loads, loadOwnedChatGPTURL, finish } = navigationHarness()
  const target = 'https://chatgpt.com/c/one'
  const first = loadOwnedChatGPTURL('chat-1', entry, target)
  const second = loadOwnedChatGPTURL('chat-1', entry, target)
  assert.deepEqual(loads, [target])
  finish()
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }])
  assert.equal(entry.navigationPromise, undefined)
  assert.equal(entry.navigationTarget, '')
})

test('navigation rejects an untrusted target before it reaches WebContents', async () => {
  const { entry, loads, loadOwnedChatGPTURL } = navigationHarness()
  await assert.rejects(loadOwnedChatGPTURL('chat-1', entry, 'https://evil.example/'), /untrusted URL/)
  assert.deepEqual(loads, [])
})
