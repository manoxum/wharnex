import test from 'node:test'
import assert from 'node:assert/strict'
import { createExpectedBundlePoll } from './poll-key.mjs'

function pollHarness(overrides = {}) {
  const calls = []
  const expected = {
    requestId: 'req-1', filename: 'response.zip', armedAt: Date.now(),
    assistantBaseline: 0, recovery: {},
  }
  const webContents = {
    isDestroyed: () => false,
    getURL: () => 'https://chatgpt.com/c/owned',
    executeJavaScript: async () => { calls.push('download-click'); return 'button' },
  }
  const entry = { view: { webContents }, loading: false }
  const context = {
    pollingExpectedChatGPTBundles: new Set(),
    expectedChatGPTBundles: new Map([['owned', expected]]),
    hasPendingChatGPTComments: () => false,
    pendingChatGPTBundleDeliveries: new Set(),
    chatgptTransportModes: new Map(),
    EXPECTED_BUNDLE_TTL_MS: 60_000,
    sendToChatGPTKey: () => calls.push('error-event'),
    chatgptViews: new Map([['owned', entry]]),
    chatGPTSupervisorOwnsExpectedResponse: () => true,
    isTrustedChatGPTOrigin: () => true,
    chooseChatGPTRecoveryAction: () => null,
    performChatGPTRecoveryAction: async () => calls.push('recovery'),
    recentlyDeliveredChatGPTBundleRequestId: () => false,
    disarmExpectedChatGPTBundle: () => calls.push('disarm'),
    chatAgentKeepFlowingRequestActive: () => false,
    DOM_DOWNLOAD_RETRY_MS: 1_000,
    captureChatGPTProcessingDuration: async () => {},
    chatGPTExpectedDownloadScript: () => 'exact-bundle-script',
    setRecentExpectedDownload: (value) => calls.push(['recent', value]),
    DOWNLOAD_INFLIGHT_TIMEOUT_MS: 20_000,
    ...overrides,
  }
  return { poll: createExpectedBundlePoll(context).pollExpectedChatGPTDownloadKey, context, expected, calls }
}

test('a concurrent poll for the same chat does not inspect the page twice', async () => {
  const { poll, context, calls } = pollHarness()
  context.pollingExpectedChatGPTBundles.add('owned')
  await poll('owned')
  assert.deepEqual(calls, [])
  assert.equal(context.pollingExpectedChatGPTBundles.has('owned'), true)
})

test('a pending bundle delivery prevents another remote download click', async () => {
  const { poll, context, calls } = pollHarness()
  context.pendingChatGPTBundleDeliveries.add('req-1')
  await poll('owned')
  assert.deepEqual(calls, [])
  assert.equal(context.pollingExpectedChatGPTBundles.has('owned'), false)
})

test('manual transport releases automatic supervision without reading the page', async () => {
  const { poll, context, calls } = pollHarness()
  context.chatgptTransportModes.set('owned', 'manual')
  await poll('owned')
  assert.deepEqual(calls, [])
  assert.equal(context.expectedChatGPTBundles.has('owned'), false)
})

test('an exact bundle click is idempotent while its download is in flight', async () => {
  const { poll, expected, calls } = pollHarness()
  await poll('owned')
  await poll('owned')
  assert.equal(expected.downloadInFlight, true)
  assert.equal(calls.filter((call) => call === 'download-click').length, 1)
  assert.deepEqual(calls.find((call) => Array.isArray(call))?.[1], {
    key: 'owned', requestId: 'req-1', at: expected.lastDOMClick,
  })
})

test('transport attention still collects the exact completed response without recovery or prompt replay', async () => {
  const { poll, context, expected, calls } = pollHarness()
  context.chatgptViews.get('owned').humanAction = { active: true, kind: 'transport' }
  await poll('owned')
  assert.equal(expected.downloadInFlight, true)
  assert.equal(calls.filter((call) => call === 'download-click').length, 1)
  assert.equal(calls.includes('recovery'), false)
})

test('authentication attention never inspects a remote response', async () => {
  const { poll, context, calls } = pollHarness()
  context.chatgptViews.get('owned').humanAction = { active: true, kind: 'authentication' }
  await poll('owned')
  assert.deepEqual(calls, [])
})

test('an adopted request keeps its passive lease alive on a generating signal without recovery', async () => {
  const { poll, context, expected, calls } = pollHarness({ chatGPTResponseCompletionScript: () => 'completion' })
  expected.rehydrating = true
  expected.progressAt = 1
  context.chatgptViews.get('owned').view.webContents.executeJavaScript = async (script) => {
    calls.push(script); return script === 'completion' ? { thinking: true } : ''
  }
  await poll('owned')
  assert.ok(expected.progressAt > 1)
  assert.equal(calls.includes('recovery'), false)
  assert.equal(calls.filter((call) => call === 'completion').length, 1)
})

test('a static historical completion cannot renew an adopted request lease', async () => {
  const { poll, context, expected } = pollHarness({ chatGPTResponseCompletionScript: () => 'completion' })
  expected.rehydrating = true
  expected.progressAt = 1
  context.chatgptViews.get('owned').view.webContents.executeJavaScript = async (script) => script === 'completion'
    ? { thinking: false, complete: true } : ''
  await poll('owned')
  assert.equal(expected.progressAt, 1)
})
