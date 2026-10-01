import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTHTTPHealth } from './index.mjs'

test('HTTP status only changes matching conversation supervision; unrelated 429 stays diagnostic', () => {
  const humanActions = []
  const faults = []
  const entry = { humanAction: undefined }
  const expected = { recovery: {}, backoffUntil: Date.now() + 10_000 }
  const expired = new Map()
  const health = createChatGPTHTTPHealth({
    chatGPTExpiredArtifactConversations: expired, EXPIRED_ARTIFACT_TTL_MS: 10 * 60_000,
    chatGPTEntryForWebContentsID: (id) => id === 7 ? ['chat', entry] : undefined,
    isChatGPTConversationTransportURL: (url) => url === 'https://chatgpt.com/backend-api/conversation',
    expectedChatGPTBundles: new Map([['chat', expected]]),
    setChatGPTHumanAction: (...args) => { humanActions.push(args); return true },
    clearChatGPTHumanAction: (...args) => humanActions.push(args),
    noteChatGPTRecoveryFault: (...args) => faults.push(args),
    getRateLimitUntil: () => 0,
  })
  assert.equal(health.noteChatGPTHTTPStatus({ webContentsId: 99, statusCode: 401 }), false)
  assert.equal(health.noteChatGPTHTTPStatus({ webContentsId: 7, statusCode: 429, url: 'https://chatgpt.com/backend-api/conversation' }), false)
  assert.equal(humanActions.length, 0)
  assert.equal(health.noteChatGPTHTTPStatus({ webContentsId: 7, statusCode: 404, url: 'https://chatgpt.com/backend-api/conversation/owned/interpreter/download' }), true)
  assert.equal(health.chatGPTArtifactExpiredSince('owned', 0), true)
  assert.equal(health.noteChatGPTHTTPStatus({ webContentsId: 7, statusCode: 404, url: 'https://example.com/backend-api/conversation/other/interpreter/download' }), false)
  assert.equal(health.chatGPTArtifactExpiredSince('other', 0), false)
  assert.equal(health.noteChatGPTHTTPStatus({ webContentsId: 7, statusCode: 401, url: 'https://chatgpt.com/backend-api/conversation' }), true)
  assert.deepEqual(humanActions[0], ['chat', 'authentication', 'HTTP 401', 'http'])
  assert.equal(health.noteChatGPTHTTPStatus({ webContentsId: 7, statusCode: 503, url: 'https://chatgpt.com/backend-api/conversation' }), true)
  assert.match(faults[0][1], /ChatGPT HTTP 503/)
  entry.humanAction = { source: 'http' }
  health.noteChatGPTHTTPStatus({ webContentsId: 7, statusCode: 200, url: 'https://chatgpt.com/backend-api/conversation' })
  assert.equal(expected.backoffUntil, 0)
  assert.deepEqual(humanActions[1], ['chat', 'HTTP 200'])
})
