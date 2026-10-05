import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createPersistedPromptRetry } from './persisted.mjs'

function fixture({ bound = false, candidates = [], tasks = [], pending = true, owner = 'chat-1', unavailable = false, conversation = 'https://chatgpt.com/c/first-conversation' } = {}) {
  const events = []
  const key = 'chat-1', requestId = 'req-1', sessionId = 'ses-1'
  const name = 'whx_bundle_req_chat-1_req-1.zip'
  const archived = Buffer.from('unchanged persisted archive')
  const entry = {}, wc = {}
  const context = {
    sanitizeChatCacheKey: (value) => value, sanitizeSessionId: (value) => value,
    requireAutoSession: async () => {}, BACKEND_URL: 'http://127.0.0.1:8080',
    fetch: async (url) => {
      const route = new URL(url).pathname
      if (route.endsWith('/artifacts')) return { ok: true, json: async () => ({ artifacts: [{ id: 'artifact-1', name, request_id: requestId, direction: 'input', kind: 'bundle' }] }) }
      if (route.endsWith('/artifact-1')) return { ok: true, arrayBuffer: async () => archived }
      if (route.endsWith('/binding-recovery')) return { ok: !unavailable, json: async () => ({ chat_id: key, bound, candidates }) }
      if (route === '/api/chat-agent/tasks') return { ok: true, json: async () => ({ tasks }) }
      if (route === '/api/sessions/ses-1') return { ok: true, json: async () => ({ id: sessionId, chat_id: owner, state: 'awaiting_plan', last_request_id: requestId, pending_manual_request_ids: pending ? [requestId] : [] }) }
      throw new Error(`Unexpected route ${route}`)
    },
    chatInputArchiveFilename: () => name, authoritativeBundleFilename: () => 'response.zip',
    canonicalChatGPTConversationURL: (url) => url.includes('/c/') ? url : '',
    path, app: { getPath: () => '/tmp' }, rm: async () => {}, mkdir: async () => {},
    MAX_CONTEXT_BYTES: 1 << 20, writeFile: async (_path, bytes) => assert.deepEqual(bytes, archived),
    chatInputPartManifest: () => undefined,
    targetChatGPTComposer: async (_key, url) => { events.push(['target', url]); return { entry, wc, conversationUrl: url.includes('/c/') ? url : '' } },
    normalizeChatGPTReasoningEffort: () => 'high', localChatInputBootstrap: () => 'bounded bootstrap',
    executeChatGPTDOMScript: async () => true, chatGPTFillComposerScript: () => 'fill',
    pasteChatGPTFile: async () => events.push(['upload']), wait: async () => {}, chatInputSettleDelay: () => 0,
    chatGPTAssistantTurnCount: async () => 0, armExpectedChatGPTBundle: () => {},
    submitChatGPTDraft: async () => events.push(['submit']), disarmExpectedChatGPTBundle: () => {},
    clearChatGPTHumanAction: () => {},
    waitForSubmittedChatGPTConversation: async () => conversation,
    persistWorkspaceChatRemoteBestEffort: async (_key, url) => events.push(['bind', url]),
    enqueueChatAgentFollowups: async () => events.push(['supervise']),
  }
  return { ...createPersistedPromptRetry(context), events, request: { cacheKey: key, expectedRequestId: requestId, sessionId } }
}

test('explicit retry submits the persisted first request after restart even before a conversation exists', async () => {
  const f = fixture()
  const result = await f.retryPersistedChatGPTPrompt(f.request)
  assert.equal(result.conversationUrl, 'https://chatgpt.com/c/first-conversation')
  assert.deepEqual(f.events, [['target', 'https://chatgpt.com/'], ['upload'], ['submit'], ['bind', result.conversationUrl], ['supervise']])
})

for (const [name, options] of [
  ['a lost existing binding', { candidates: [{ chatgpt_url: 'https://chatgpt.com/c/existing' }] }],
  ['a bound chat', { bound: true }],
  ['a supervised request', { tasks: [{ type: 'AWAIT_RESPONSE', status: 'WAITING' }] }],
  ['a cancelled response observation', { tasks: [{ type: 'AWAIT_RESPONSE', status: 'CANCELLED' }] }],
  ['an active write', { tasks: [{ type: 'BOT_WRITE', status: 'RUNNING' }] }],
  ['an accepted write', { tasks: [{ type: 'BOT_WRITE', status: 'DONE' }] }],
  ['a failed write with ambiguous dispatch', { tasks: [{ type: 'BOT_WRITE', status: 'FAILED' }] }],
  ['a superseded request', { pending: false }],
  ['another chat session', { owner: 'other-chat' }],
  ['unavailable binding evidence', { unavailable: true }],
]) {
  test(`unbound first-request retry refuses ${name} before touching ChatGPT`, async () => {
    const f = fixture(options)
    await assert.rejects(f.retryPersistedChatGPTPrompt(f.request))
    assert.deepEqual(f.events, [])
  })
}

test('an arbitrary unbound URL is rejected before touching ChatGPT', async () => {
  const f = fixture()
  await assert.rejects(f.retryPersistedChatGPTPrompt({ ...f.request, url: 'https://chatgpt.com/g/unrelated' }))
  assert.deepEqual(f.events, [])
})

test('submission without concrete affinity cannot acquire durable supervision', async () => {
  const f = fixture({ conversation: '' })
  await assert.rejects(f.retryPersistedChatGPTPrompt(f.request), /conversa ChatGPT vinculada/)
  assert.deepEqual(f.events, [['target', 'https://chatgpt.com/'], ['upload'], ['submit']])
})
