import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopRequestPreparation } from './runtime.mjs'

test('request preparation keeps upload and renderer recovery lazy while enforcing auto mode', async () => {
  let fetched = 0
  const preparation = createDesktopRequestPreparation({
    BACKEND_URL: 'http://127.0.0.1:6969', MAX_CONTEXT_BYTES: 1024,
    sanitizeSessionId: (value) => value,
    fetch: async (url) => {
      fetched += 1
      assert.equal(url.pathname, '/api/sessions/session-1')
      return { ok: true, json: async () => ({ automation_mode: 'auto_approve' }) }
    },
    app: { getPath: () => '/tmp', getFileIcon: async () => undefined },
    pasteChatGPTFile: () => { throw new Error('upload ran during composition') },
    recoverChatGPTConversationLoadFailure: () => { throw new Error('recovery ran during composition') },
  })
  assert.equal(typeof preparation.materializeChatInput, 'function')
  assert.equal(typeof preparation.executeChatGPTDOMScript, 'function')
  await preparation.requireAutoSession('session-1')
  assert.equal(fetched, 1)
})
