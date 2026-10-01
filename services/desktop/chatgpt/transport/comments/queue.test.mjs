import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTCommentQueue } from './index.mjs'

function fixture() {
  const pendingChatGPTComments = new Map()
  const recentChatGPTCommentIds = new Map()
  const recentChatGPTCommentFingerprints = new Map()
  const flushingChatGPTComments = new Set()
  const entry = { humanAction: undefined }
  const sent = []
  const armed = []
  let ready = false
  let prompt = ''
  const queue = createChatGPTCommentQueue({
    sanitizeChatCacheKey: (key) => key,
    canonicalBundleFilename: (key, id) => `${key}-${id}.zip`,
    normalizeChatGPTReasoningEffort: (effort) => effort || 'standard',
    pendingChatGPTComments, recentChatGPTCommentIds, recentChatGPTCommentFingerprints,
    flushingChatGPTComments, sanitizeSessionId: (id) => id,
    chatgptViews: new Map([['chat', entry]]),
    withChatGPTTransportPreparation: async (_key, _entry, _requestId, send) => send(),
    targetChatGPTComposer: async () => ({ entry, wc: {}, conversationUrl: 'https://chatgpt.com/c/owned' }),
    executeChatGPTDOMScript: async () => ready,
    chatGPTComposerReadyScript: () => 'ready-script',
    expectedChatGPTBundles: new Map([['chat', { requestId: 'request', filename: 'expected.zip', originalPrompt: 'original task', requestMetadata: { original: true } }]]),
    fillBundledChatGPTComposer: async (_key, _entry, _sessionId, _requestId, text) => { prompt = text; return { attachmentCount: 0 } },
    chatGPTAssistantTurnCount: async () => 2,
    wait: async () => {},
    submitChatGPTDraft: async () => { sent.push(prompt) },
    armExpectedChatGPTBundle: (...args) => armed.push(args),
    touchChatGPTEntry: () => {},
    sendToChatGPTKey: () => {},
  })
  return { queue, pendingChatGPTComments, flushingChatGPTComments, sent, armed, setReady: (value) => { ready = value } }
}

test('comments preserve enqueue order, suppress pending duplicates, and rearm after each submit', async () => {
  const { queue, pendingChatGPTComments, sent, armed, setReady } = fixture()
  const first = { cacheKey: 'chat', requestId: 'request', commentId: 'first', text: 'first guidance' }
  const second = { cacheKey: 'chat', requestId: 'request', commentId: 'second', text: 'second guidance' }
  assert.equal((await queue.queueChatGPTComment(first)).queued, true)
  await queue.queueChatGPTComment(second)
  await queue.queueChatGPTComment(first)
  assert.equal(pendingChatGPTComments.get('chat').length, 2)
  setReady(true)
  await queue.flushQueuedChatGPTComments()
  assert.equal(queue.hasPendingChatGPTComments('chat'), true)
  await queue.flushQueuedChatGPTComments()
  assert.equal(queue.hasPendingChatGPTComments('chat'), false)
  assert.equal(sent.length, 2)
  assert.match(sent[0], /first guidance[\s\S]*original task/)
  assert.match(sent[1], /second guidance[\s\S]*original task/)
  assert.equal(armed.length, 2)
  assert.equal(armed[0][2], 2)
  assert.equal(armed[0][7], 'expected.zip')
  assert.equal((await queue.queueChatGPTComment(first)).duplicate, true)
  assert.equal((await queue.queueChatGPTComment({ ...first, commentId: 'other-id' })).duplicate, true)
  assert.equal(sent.length, 2)
})

test('an in-flight comment holds its lane and does not submit a second copy', async () => {
  const { queue, pendingChatGPTComments, flushingChatGPTComments, sent, setReady } = fixture()
  await queue.queueChatGPTComment({ cacheKey: 'chat', requestId: 'request', commentId: 'only', text: 'guidance' })
  setReady(true)
  flushingChatGPTComments.add('chat')
  await queue.flushQueuedChatGPTComments()
  assert.equal(sent.length, 0)
  assert.equal(pendingChatGPTComments.get('chat').length, 1)
  flushingChatGPTComments.delete('chat')
  await queue.flushQueuedChatGPTComments()
  assert.equal(sent.length, 1)
})
