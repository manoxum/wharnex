import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTThrottle } from './index.mjs'

test('hidden utility artifacts keep their Worker renderer at full speed until disarmed', () => {
  const toggles = []
  const worker = {
    loading: false, conversationRequests: new Map(),
    view: { webContents: { isDestroyed: () => false, setBackgroundThrottling: (allowed) => toggles.push(allowed) } },
  }
  const expectedChatGPTTodoClassifications = new Map([['result.zip', { key: 'chat' }]])
  const expectedChatGPTUITestDiscoveries = new Map([['discovery.zip', { key: 'chat' }]])
  const throttle = createChatGPTThrottle({
    expectedChatGPTBundles: new Map(), expectedChatGPTTranslations: new Map(),
    expectedChatGPTReleaseNotes: new Map(), expectedChatGPTTodoClassifications, expectedChatGPTUITestDiscoveries,
    expectedChatGPTOrchestratorPlans: new Map(), chatgptViews: new Map(),
    pendingChatGPTComments: new Map(), windowStateForEntry: () => undefined,
  })
  assert.equal(throttle.chatGPTArtifactExpectationArmed('chat'), true)
  throttle.reconcileChatGPTThrottleForKey('chat', worker)
  assert.deepEqual(toggles, [false])
  assert.equal(worker.backgroundThrottled, false)
  throttle.reconcileChatGPTThrottleForKey('chat', worker)
  assert.deepEqual(toggles, [false])
  expectedChatGPTTodoClassifications.clear()
  throttle.reconcileChatGPTThrottleForKey('chat', worker)
  assert.deepEqual(toggles, [false])
  expectedChatGPTUITestDiscoveries.clear()
  throttle.reconcileChatGPTThrottleForKey('chat', worker)
  assert.deepEqual(toggles, [false, true])
  assert.equal(worker.backgroundThrottled, true)
  worker.view.webContents.isDestroyed = () => true
  throttle.reconcileChatGPTThrottleForKey('chat', worker)
  assert.deepEqual(toggles, [false, true])
})
