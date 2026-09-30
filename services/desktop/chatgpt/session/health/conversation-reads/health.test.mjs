import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTConversationReadHealth } from './index.mjs'

function fixture() {
  const releases = []
  const health = createChatGPTConversationReadHealth({
    chatGPTConversationLoadFailureScript: (click) => click,
    canonicalChatGPTConversationURL: (url) => url,
    chatGPTConversationID: (url) => url.split('/').at(-1),
    wait: async () => {}, paceChatGPTWorkerNavigation: async () => {},
    createConversationUnavailable: (delayMs) => Object.assign(new Error('unavailable'), { delayMs }),
    chatAgentResidency: { releaseResidentLane: (slot) => releases.push(slot) },
    createChatGPTAffinityTracker: () => ({ phase: 'unbound' }),
  })
  return { health, releases }
}

test('two distinct conversation failures trigger cooldown, then only one task probes', () => {
  const originalNow = Date.now
  let now = 100_000
  Date.now = () => now
  try {
    const { health } = fixture()
    health.noteChatGPTConversationReadFailure('conversation-1')
    assert.equal(health.chatGPTConversationReadCooldownMs(), 0)
    health.noteChatGPTConversationReadFailure('conversation-2')
    assert.equal(health.chatGPTConversationReadCooldownMs(), 3 * 60_000)
    now += 3 * 60_000 + 1
    assert.equal(health.chatGPTConversationReadGateMs('task-1'), 0)
    assert.equal(health.chatGPTConversationReadGateMs('task-2'), 30_000)
    health.releaseChatGPTConversationReadProbe('task-1')
    assert.equal(health.chatGPTConversationReadGateMs('task-2'), 0)
    health.noteChatGPTConversationReadFailure('conversation-2')
    assert.equal(health.chatGPTConversationReadCooldownMs(), 6 * 60_000)
    health.noteChatGPTConversationReadHealthy()
    now += 6 * 60_000 + 1
    assert.equal(health.chatGPTConversationReadGateMs('task-3'), 0)
  } finally { Date.now = originalNow }
})

test('a conversation still unavailable after bounded retry defers and parks its Worker', async () => {
  const { health, releases } = fixture()
  const actions = []
  const wc = {
    getURL: () => 'https://chatgpt.com/c/conversation', isDestroyed: () => false,
    executeJavaScript: async () => ({ failed: true, retryable: false }),
    reload: () => actions.push('reload'),
    loadURL: async (url) => actions.push(url),
  }
  const entry = { role: 'worker', slotId: 'worker-1', view: { webContents: wc }, affinity: { phase: 'bound' } }
  await assert.rejects(
    health.recoverChatGPTConversationLoadFailure('chat', entry, wc, async () => actions.push('settle')),
    (error) => error.delayMs >= 2 * 60_000,
  )
  assert.deepEqual(actions, ['reload', 'settle'])
  assert.equal(entry.parkAfterLoadFailure, true)
  health.parkChatGPTWorkerAfterLoadFailure(entry)
  assert.deepEqual(releases, ['worker-1'])
  assert.equal(entry.ownerKey, '')
  assert.equal(entry.affinity.phase, 'unbound')
  assert.equal(entry.parkAfterLoadFailure, false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(actions, ['reload', 'settle', 'about:blank'])
})
