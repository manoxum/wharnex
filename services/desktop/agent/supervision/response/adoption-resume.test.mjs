import test from 'node:test'
import assert from 'node:assert/strict'
import { adoptSubmittedPrompt } from '../../../chatgpt/transport/requests/preparation/adopt.mjs'
import { createChatAgentFollowups, createResponseLineage } from './index.mjs'

test('adopted submission stays observation-only after serializing and restoring its task', async () => {
  let durableTask
  const followups = createChatAgentFollowups({
    canonicalChatGPTConversationURL: (url) => url,
    authoritativeBundleFilename: (name) => name,
    chatAgentInitialRequestWaitMs: () => 0,
    enqueueChatAgentTask: async (_type, task) => {
      durableTask = JSON.parse(JSON.stringify(task))
      return { task_id: 'await-1' }
    },
  })
  const expectations = new Map()
  await adoptSubmittedPrompt({
    executeChatGPTDOMScript: async () => ({ submitted: true }),
    chatGPTSubmittedRequestEvidenceScript: (name) => name,
    armExpectedChatGPTBundle: (key, requestId) => expectations.set(key, { requestId }),
    disarmExpectedChatGPTBundle: () => assert.fail('unexpected disarm'),
    enqueueChatAgentFollowups: followups.enqueueChatAgentFollowups,
    expectedChatGPTBundles: expectations,
    persistWorkspaceChatRemoteBestEffort: async () => {},
  }, {
    key: 'owned', requestId: 'req', sessionId: 'session', expectedFilename: 'response.zip',
    target: { entry: {}, conversationUrl: 'https://chatgpt.com/c/owned' },
    input: { archiveName: 'input.zip', uploadPaths: ['input.zip'] },
  })
  assert.equal(durableTask.payload.observation_only, true)
  // A fresh map represents the restarted main process, not the old flag in RAM.
  const restored = new Map()
  let writes = 0
  const lineage = createResponseLineage({
    expectedChatGPTBundles: restored,
    armExpectedChatGPTBundle: (key, requestId) => restored.set(key, { requestId }),
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS: 1, chatGPTBundleAlreadyValidated: () => false,
    getScheduler: () => ({ list: async () => ({ tasks: [] }) }),
    enqueueChatAgentTask: async () => { writes++ },
    CHAT_AGENT_AWAIT_PROBE_MS: 30_000,
  })
  const task = { task_id: 'await-1', request_id: 'req' }
  const expected = lineage.hydrateExpectedChatAgentBundle('owned', task, durableTask.payload)
  assert.equal(expected.rehydrating, true)
  const result = await lineage.enqueueChatAgentContinuation(task, 'owned', expected,
    durableTask.payload, 'https://chatgpt.com/c/owned', Date.now(), 'completed-without-bundle')
  assert.equal(result.observation, true)
  assert.equal(writes, 0)
})
