import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createUITestingChat } from './chatgpt.mjs'

const taskID = `cat_${'d'.repeat(20)}`

function chat({ gate = '' } = {}) {
  const stages = []
  const expected = new Map()
  const submitted = []
  const targets = []
  const client = createUITestingChat({
    paceChatGPTWorkerSubmission: async () => {}, chatAgentRateLimitDelayMs: () => 0,
    targetChatGPTComposer: async (_key, url) => { targets.push(url); return { entry:{}, wc:{}, conversationUrl:'' } }, CHATGPT_URL:'https://chatgpt.com/',
    executeChatGPTDOMScript: async (_key, _entry, stage) => { stages.push(stage); return stage === 'ui-test-health' ? { required:Boolean(gate), kind:gate } : true },
    chatGPTFillComposerScript: (value) => value, pasteChatGPTFile: async () => {}, wait: async () => new Promise((resolve) => setTimeout(resolve, 1)),
    chatInputSettleDelay: () => 0, chatGPTAssistantTurnCount: async () => 0,
    submitChatGPTDraft: async () => { submitted.push(true) }, waitForSubmittedChatGPTConversation: async () => 'https://chatgpt.com/c/run',
    expectedChatGPTUITestDiscoveries: expected, reconcileChatGPTThrottleForKey: () => {},
    chatGPTHumanActionScript: () => 'health', noteChatGPTRateLimitGate: () => false, setChatGPTHumanAction: () => {}, chatGPTHumanActionMessage: (kind) => `needs ${kind}`,
    pollWorkerExpectedDownload: async (record) => { if (!gate) record.resolve(Buffer.from('answer')) },
    chatGPTExpectedDownloadScript: () => 'download', enqueueChatAgentTask: async () => ({}), chatAgentConversationID: () => 'run',
    MAX_UI_TEST_DISCOVERY_REQUEST_BYTES: 1024, MARKDOWN_TRANSLATION_POLL_MS: 1,
    path, app:{ getPath: () => '/tmp' }, mkdir: async () => {}, writeFile: async () => {}, rm: async () => {},
  })
  return { client, stages, expected, submitted, targets }
}

const issued = (result) => ({ request:{ request_filename:result.replace('_res_', '_req_'), result_filename:result }, bootstrap:'Read the bundle.', archive_base64:Buffer.from('zip').toString('base64') })

test('an exchange returns only the exact response bundle and never reads the answer', async () => {
  const { client, stages, expected, submitted, targets } = chat()
  const state = await client.start({}, 'owned')
  const result = await client.exchange(state, 'owned', taskID, issued(`whx_ui_test_step_res_${taskID}_1.zip`))
  await client.exchange(state, 'owned', taskID, issued(`whx_ui_test_step_res_${taskID}_2.zip`))
  assert.deepEqual(targets, ['https://chatgpt.com/', 'https://chatgpt.com/', 'https://chatgpt.com/c/run'], 'every exchange re-targets the run conversation')
  assert.equal(result.filename, `whx_ui_test_step_res_${taskID}_1.zip`)
  assert.equal(result.bytes.toString(), 'answer')
  assert.equal(submitted.length, 2)
  assert.equal(expected.size, 0)
  assert.equal(stages.some((stage) => stage.includes('read')), false)
})

test('foreign artifacts are refused before anything reaches ChatGPT', async () => {
  const { client, submitted } = chat()
  const state = await client.start({}, 'owned')
  for (const name of [`whx_ui_test_step_res_cat_${'e'.repeat(20)}_1.zip`, 'answer.zip', `whx_translation_res_${taskID}.zip`]) {
    await assert.rejects(client.exchange(state, 'owned', taskID, issued(name)), /foreign artifact/)
  }
  assert.equal(submitted.length, 0)
})

test('a sign-in gate during an exchange surfaces as human action', async () => {
  const { client } = chat({ gate:'authentication' })
  const state = await client.start({}, 'owned')
  const error = await client.exchange(state, 'owned', taskID, issued(`whx_ui_test_guide_res_${taskID}.zip`)).catch((reason) => reason)
  assert.equal(error.humanAction, 'authentication')
})
