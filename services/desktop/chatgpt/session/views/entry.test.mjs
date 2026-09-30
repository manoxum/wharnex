import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTViewEntry, advanceChatGPTConversationTransportGeneration } from './entry.mjs'

test('Supervisor and Worker views receive isolated transport and affinity state', () => {
  const affinity = () => ({ boundURL: '' })
  const supervisor = createChatGPTViewEntry({}, 'chat-1', 'window-1', affinity)
  const worker = createChatGPTViewEntry({}, '', 'window-1', affinity, {
    role: 'worker', slotId: 'worker-1', attached: false,
  })
  supervisor.conversationRequests.set('request', {})
  supervisor.affinity.boundURL = 'https://chatgpt.com/c/one'
  assert.equal(worker.conversationRequests.size, 0)
  assert.equal(worker.affinity.boundURL, '')
  assert.equal(worker.attached, false)
  assert.equal(supervisor.parkedLayout, true)
  assert.equal(worker.layoutViewportGranted, true)
})

test('new navigation generation reconciles transport and discards stale request markers', () => {
  const entry = createChatGPTViewEntry({}, 'chat-1', 'window-1', () => ({}))
  entry.staleConversationRequestIds.add('old')
  const calls = []
  advanceChatGPTConversationTransportGeneration(entry, {
    classifyChatGPTConversationTransport: (_requests, state) => { calls.push(state.generation); return { state: 'idle' } },
    reconcileChatGPTConversationTransport: () => calls.push('reconciled'),
  })
  assert.deepEqual(calls, [1, 'reconciled'])
  assert.equal(entry.staleConversationRequestIds.size, 0)
})
