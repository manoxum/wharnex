import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTActivityPoll } from './poll.mjs'

function activityHarness({ armed = false, polling = false } = {}) {
  const scripts = []
  const events = []
  const entry = {
    view: { webContents: {
      isDestroyed: () => false,
      getURL: () => 'https://chatgpt.com/c/owned',
      executeJavaScript: async (script) => {
        scripts.push(script)
        return script === 'health' ? { composerReady: true, pageVisible: true } : { state: 'thinking', text: 'working', capturedAt: 'now' }
      },
    } },
  }
  const expected = { requestId: 'req-1', recovery: {} }
  const context = {
    readPollingChatGPTVisibleActivity: () => polling,
    setPollingChatGPTVisibleActivity: (value) => { polling = value },
    chatgptViews: new Map([['owned', entry]]),
    reconcileChatGPTThrottle: () => {},
    isTrustedChatGPTOrigin: () => true,
    chatgptTransportModes: new Map(),
    chatGPTHumanActionScript: () => 'health',
    noteChatGPTRateLimitGate: () => false,
    expectedChatGPTBundles: new Map(armed ? [['owned', expected]] : []),
    noteChatGPTRecoveryProgress: () => {},
    clearChatGPTHumanAction: () => {},
    chatGPTVisibleActivityScript: () => 'activity',
    chatGPTActivityFingerprints: new Map(),
    sendToChatGPTKey: (_key, _channel, payload) => events.push(payload),
    CHATGPT_DOM_PROBE_FAILURE_LIMIT: 3,
  }
  return { poll: createChatGPTActivityPoll(context).pollChatGPTVisibleActivity, scripts, events, isPolling: () => polling }
}

test('an active activity poll rejects a concurrent tick before touching the page', async () => {
  const { poll, scripts, isPolling } = activityHarness({ armed: true, polling: true })
  await poll()
  assert.deepEqual(scripts, [])
  assert.equal(isPolling(), true)
})

test('an idle owned surface receives only the bounded health probe', async () => {
  const { poll, scripts, events, isPolling } = activityHarness()
  await poll()
  assert.deepEqual(scripts, ['health'])
  assert.deepEqual(events, [])
  assert.equal(isPolling(), false)
})

test('an armed response emits changed visible activity once and releases single-flight state', async () => {
  const { poll, scripts, events, isPolling } = activityHarness({ armed: true })
  await poll()
  await poll()
  assert.deepEqual(scripts, ['health', 'activity', 'health', 'activity'])
  assert.equal(events.length, 1)
  assert.equal(events[0].requestId, 'req-1')
  assert.equal(isPolling(), false)
})
