import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopChatGPTTransportStage } from './runtime.mjs'

test('transport stage composes request, account, pacing, and dispatch without using late callbacks', () => {
  const late = () => { throw new Error('late callback ran during composition') }
  const stage = createDesktopChatGPTTransportStage({
    BACKEND_URL: 'http://127.0.0.1:6969', MAX_CONTEXT_BYTES: 1024,
    app: { getPath: () => '/tmp', getFileIcon: async () => undefined },
    chatgptViews: new Map(), chatGPTWorkerEntries: [],
    rateLimitState: { until: 0, resumeProbeRequired: false },
    getRuntimeDiagnostics: () => ({ provider: { rate_limit_level: 0 } }),
    durableWorkspaceChatID: late, persistWorkspaceChatRemoteBestEffort: late,
    enqueueChatAgentFollowups: late, enqueueChatAgentTask: late,
    getChatAgentScheduler: late,
  })
  assert.equal(typeof stage.materializeChatInput, 'function')
  assert.equal(typeof stage.executeChatGPTDOMScript, 'function')
  assert.equal(typeof stage.ensureChatGPTProject, 'function')
  assert.equal(typeof stage.paceChatGPTWorkerNavigation, 'function')
  assert.equal(typeof stage.submitChatGPTDraft, 'function')
  assert.equal(typeof stage.preparePromptForChatGPT, 'function')
})
