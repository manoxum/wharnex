import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createMarkdownTranslationWorker } from '../translation/worker.mjs'
import { createTodoClassificationWorker } from '../todo/classification-worker.mjs'

const task = { task_id: 'task-1', attempt: 0 }
const requestFilename = 'whx_translation_req_cat_aaaaaaaaaaaaaaaaaaaa.zip'
const todoRequestFilename = 'whx_todo_classification_req_cat_aaaaaaaaaaaaaaaaaaaa.zip'

test('translation rejects a foreign result and an oversized ZIP before provider access', async () => {
  let paced = 0
  const worker = createMarkdownTranslationWorker({
    markdownTranslationFilename: () => 'result.zip',
    MAX_MARKDOWN_TRANSLATION_BYTES: 1,
    paceChatGPTWorkerSubmission: async () => { paced += 1 },
  }).executeChatAgentMarkdownTranslation
  const base = {
    protocol: 'wharness.translation-input/v1', task: 'translate_document',
    request_filename: requestFilename, result_filename: 'result.zip', bootstrap: 'request',
    archive_base64: Buffer.from('abc').toString('base64'),
  }
  assert.deepEqual(await worker(task, {}, 'owned', { ...base, result_filename: 'foreign.zip' }), {
    status: 'failed', error: 'translation worker payload names a foreign result artifact',
  })
  assert.deepEqual(await worker(task, {}, 'owned', base), {
    status: 'failed', error: 'translation request archive exceeds the transport limit',
  })
  assert.equal(paced, 0)
})

test('TODO classification rejects a foreign result and an oversized ZIP before provider access', async () => {
  let paced = 0
  const worker = createTodoClassificationWorker({
    todoClassificationFilename: () => 'result.zip',
    MAX_TODO_CLASSIFICATION_BYTES: 1,
    paceChatGPTWorkerSubmission: async () => { paced += 1 },
  }).executeChatAgentTodoClassification
  const base = {
    protocol: 'wharness.todo-classification-input/v1', task: 'classify_todo',
    request_filename: todoRequestFilename, result_filename: 'result.zip', bootstrap: 'request',
    archive_base64: Buffer.from('ab').toString('base64'),
  }
  assert.deepEqual(await worker(task, {}, 'owned', { ...base, result_filename: 'foreign.zip' }), {
    status: 'failed', error: 'TODO classification payload names a foreign result artifact',
  })
  assert.deepEqual(await worker(task, {}, 'owned', base), {
    status: 'failed', error: 'TODO classification request archive is invalid',
  })
  assert.equal(paced, 0)
})

test('TODO classification clicks the exact download affordance once while polling', async () => {
  const calls = []
  const entry = { view: { webContents: {} } }
  const target = { entry, wc: entry.view.webContents, conversationUrl: '' }
  const expected = new Map()
  const worker = createTodoClassificationWorker({
    todoClassificationFilename: () => 'result.zip',
    MAX_TODO_CLASSIFICATION_BYTES: 1024,
    paceChatGPTWorkerSubmission: async () => {},
    chatAgentRateLimitDelayMs: () => 0,
    path,
    app: { getPath: () => '/tmp' },
    rm: async () => {}, mkdir: async () => {}, writeFile: async () => {},
    expectedChatGPTTodoClassifications: expected,
    reconcileChatGPTThrottleForKey: () => {},
    targetChatGPTComposer: async () => target,
    CHATGPT_URL: 'https://chatgpt.com/',
    executeChatGPTDOMScript: async (_key, _entry, stage) => {
      calls.push(stage)
      if (stage === 'todo-classification-completion') return { assistantCount: 1 }
      if (stage === 'todo-classification-health') return {}
      return true
    },
    chatGPTFillComposerScript: (value) => value,
    pasteChatGPTFile: async () => {},
    wait: async () => new Promise((resolve) => setTimeout(resolve, 1)),
    chatInputSettleDelay: () => 0,
    chatGPTAssistantTurnCount: async () => 0,
    submitChatGPTDraft: async () => ({ accepted: true }),
    waitForSubmittedChatGPTConversation: async () => 'https://chatgpt.com/c/owned',
    TODO_CLASSIFICATION_TIMEOUT_MS: 150,
    MARKDOWN_TRANSLATION_POLL_MS: 1,
    chatGPTHumanActionScript: () => 'health',
    noteChatGPTRateLimitGate: () => false,
    chatGPTResponseCompletionScript: () => 'completion',
    chatGPTExpectedDownloadScript: () => 'download',
    enqueueChatAgentTask: async () => ({}),
    chatAgentConversationID: () => 'owned',
  }).executeChatAgentTodoClassification
  const payload = {
    protocol: 'wharness.todo-classification-input/v1', task: 'classify_todo',
    request_filename: todoRequestFilename, result_filename: 'result.zip', bootstrap: 'request',
    archive_base64: Buffer.from('zip').toString('base64'),
  }
  await assert.rejects(worker(task, entry, 'owned', payload), /TODO classification timeout/)
  assert.ok(calls.filter((stage) => stage === 'todo-classification-completion').length > 1)
  assert.equal(calls.filter((stage) => stage === 'todo-classification-download').length, 1)
  assert.equal(expected.size, 0)
})
