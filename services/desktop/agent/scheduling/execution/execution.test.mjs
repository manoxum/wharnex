import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccountLifecycleExecutor } from './account-lifecycle.mjs'
import { createChatAgentTaskDispatcher } from './dispatcher.mjs'

const workerEntry = { slotId: 'worker-1', view: { webContents: { getURL: () => 'https://chatgpt.com/c/owned' } } }

function dispatcher(overrides = {}) {
  const calls = []
  const operations = createChatAgentTaskDispatcher({
    workerEntryForIndex: () => workerEntry,
    executeChatTranslatorTask: async () => { calls.push('translator'); return { status: 'done' } },
    chatAgentRateLimitDelayMs: () => 0,
    chatGPTConversationReadGateMs: () => 0,
    chatAgentTaskPayload: () => ({}),
    sanitizeChatCacheKey: (key) => key,
    chatAgentConversationURL: () => 'https://chatgpt.com/c/owned',
    chatGPTSupervisorOwnsExpectedResponse: () => false,
    CHAT_AGENT_AWAIT_PROBE_MS: 30_000,
    assignChatGPTWorker: () => { calls.push('assign'); throw new Error('unexpected assignment') },
    ...overrides,
  })
  return { execute: operations.executeChatAgentTask, calls }
}

test('translation uses its dedicated Worker path before ordinary cooldown and assignment', async () => {
  const { execute, calls } = dispatcher({ chatAgentRateLimitDelayMs: () => 60_000 })
  assert.deepEqual(await execute({ type: 'TRANSLATE_MARKDOWN' }, { worker: 1 }), { status: 'done' })
  assert.deepEqual(calls, ['translator'])
})

test('AWAIT_RESPONSE yields without assigning a Worker when its Supervisor owns the response', async () => {
  const { execute, calls } = dispatcher({ chatGPTSupervisorOwnsExpectedResponse: () => true })
  const result = await execute({ type: 'AWAIT_RESPONSE', chat_id: 'owned', request_id: 'req-1' }, { worker: 1 })
  assert.deepEqual(result, {
    status: 'waiting', delayMs: 30_000, observation: true,
    error: 'visible Supervisor owns response supervision',
  })
  assert.deepEqual(calls, [])
})

test('remote bundle cleanup requires confirmed local persistence before account access', async () => {
  let remoteCalls = 0
  const execute = createAccountLifecycleExecutor({
    deleteChatGPTLibraryArtifact: async () => { remoteCalls += 1; return { ok: true } },
  }).executeChatAgentAccountTask
  const result = await execute({ type: 'DELETE_BUNDLE' }, workerEntry, 'owned', {
    locally_persisted: false, canonical_filename: 'bundle.zip',
  }, 'https://chatgpt.com/c/owned')
  assert.deepEqual(result, { status: 'attention', error: 'remote bundle cleanup requires confirmed local persistence' })
  assert.equal(remoteCalls, 0)
})

test('a duplicate remote project requires attention before local affinity is updated', async () => {
  let persisted = 0
  const execute = createAccountLifecycleExecutor({
    organizeChatGPTConversation: async () => ({ ok: false, state: 'duplicate-project', project: 'Wharnex' }),
    persistWorkspaceChatRemote: async () => { persisted += 1 },
  }).executeChatAgentAccountTask
  const result = await execute({ type: 'ORGANIZE_CHAT' }, workerEntry, 'owned', {
    project_name: 'Wharnex', title: 'title',
  }, 'https://chatgpt.com/c/owned')
  assert.deepEqual(result, { status: 'attention', error: 'Projeto ChatGPT duplicado: Wharnex' })
  assert.equal(persisted, 0)
})
