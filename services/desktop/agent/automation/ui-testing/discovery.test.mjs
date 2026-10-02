import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createUITestingDiscoveryWorker } from './discovery.mjs'

const taskID = `cat_${'a'.repeat(20)}`

test('UI discovery transports an exact response bundle without reading assistant prose', async () => {
  const stages = []
  const posts = []
  const expected = new Map()
  const worker = createUITestingDiscoveryWorker({
    uiTestingDiscoveryFilename: (id) => `whx_ui_test_discovery_res_${id}.zip`,
    MAX_UI_TEST_DISCOVERY_REQUEST_BYTES: 1024,
    UI_TEST_DISCOVERY_TIMEOUT_MS: 200,
    MARKDOWN_TRANSLATION_POLL_MS: 1,
    paceChatGPTWorkerSubmission: async () => {},
    chatAgentRateLimitDelayMs: () => 0,
    path,
    app: { getPath: () => '/tmp' },
    rm: async () => {}, mkdir: async () => {}, writeFile: async () => {},
    expectedChatGPTUITestDiscoveries: expected,
    reconcileChatGPTThrottleForKey: () => {},
    requireOwnedChatGPTEntry: () => ({ wc: { reload() {} } }),
    waitForChatGPTSurfaceReady: async () => {},
    targetChatGPTComposer: async () => ({ entry: {}, wc: {}, conversationUrl: '' }),
    CHATGPT_URL: 'https://chatgpt.com/',
    executeChatGPTDOMScript: async (_key, _entry, stage) => { stages.push(stage); return stage.endsWith('health') ? {} : true },
    chatGPTFillComposerScript: (value) => value,
    pasteChatGPTFile: async () => {},
    wait: async () => new Promise((resolve) => setTimeout(resolve, 1)),
    chatInputSettleDelay: () => 0,
    chatGPTAssistantTurnCount: async () => 0,
    submitChatGPTDraft: async () => ({ accepted:true }),
    waitForSubmittedChatGPTConversation: async () => 'https://chatgpt.com/c/owned',
    chatGPTHumanActionScript: () => 'health',
    noteChatGPTRateLimitGate: () => false,
    setChatGPTHumanAction: () => {},
    chatGPTHumanActionMessage: () => 'verification',
    pollWorkerExpectedDownload: async (record) => { record.resolve(Buffer.from('result-bundle')); return 'clicked' },
    chatGPTExpectedDownloadScript: () => 'download',
    enqueueChatAgentTask: async () => ({}),
    chatAgentConversationID: () => 'owned',
    post: async (_pathname, body) => { posts.push(body); return { environments:[{}], tests:[{}, {}] } },
  })
  const payload = {
    protocol:'wharnex.ui-test-discovery-input/v1',
    request:{ task:'discover_ui_tests', task_id:taskID, request_filename:`whx_ui_test_discovery_req_${taskID}.zip`, result_filename:`whx_ui_test_discovery_res_${taskID}.zip` },
    bootstrap:'Read the request bundle.', archive_base64:Buffer.from('request-bundle').toString('base64'),
  }
  const result = await worker.discover({ task_id:taskID, attempt:0 }, {}, 'owned', payload)
  assert.equal(result.status, 'done')
  assert.equal(result.payload.tests, 2)
  assert.deepEqual(posts, [{ filename:`whx_ui_test_discovery_res_${taskID}.zip`, bundle_base64:Buffer.from('result-bundle').toString('base64') }])
  assert.equal(stages.some((stage) => stage.includes('read-answer')), false)
  assert.equal(expected.size, 0)
})
