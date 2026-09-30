import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTHumanAttention } from './notice.mjs'

test('human attention is deduplicated, recorded durably, and cleared for the owned view', () => {
  const events = []
  const entry = { transportRequestId: 'request', humanAction: undefined }
  const state = { window: {
    isDestroyed: () => false, isFocused: () => true,
    flashFrame: (active) => events.push(['flash', active]),
  } }
  const attention = createChatGPTHumanAttention({
    chatgptViews: new Map([['chat', entry]]),
    expectedChatGPTBundles: new Map([['chat', { requestId: 'request' }]]),
    retryableChatGPTPrompts: new Map(), windowStateForEntry: () => state,
    sendToChatGPTKey: (_key, _channel, payload) => events.push(['ipc', payload]),
    sendToWindowState: () => {}, Notification: { isSupported: () => false },
    recordChatGPTTaskEvent: (_expected, kind, payload) => events.push(['event', kind, payload]),
  })
  assert.equal(attention.setChatGPTHumanAction('chat', 'transport', 'offline', 'network'), true)
  assert.equal(attention.setChatGPTHumanAction('chat', 'transport', 'offline', 'network'), false)
  assert.equal(events.filter(([type]) => type === 'event').length, 1)
  assert.equal(events.find(([type]) => type === 'event')[1], 'chatgpt.human_action_required')
  assert.equal(entry.humanAction.requestId, 'request')
  assert.equal(attention.clearChatGPTHumanAction('chat', 'reconnected'), true)
  assert.equal(attention.clearChatGPTHumanAction('chat'), false)
  assert.equal(entry.humanAction, undefined)
  assert.deepEqual(events.filter(([type]) => type === 'flash'), [['flash', true], ['flash', false]])
  assert.match(events.at(-1)[1].message, /reconnected/)
})
