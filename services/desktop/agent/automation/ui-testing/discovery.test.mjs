import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createUITestingDiscoveryWorker } from './discovery.mjs'

const taskID = `cat_${'a'.repeat(20)}`

for (const failure of ['', 'attachment', 'refill', 'sign-in']) test(`UI discovery bundle transport: ${failure || 'success'}`, async () => {
  const stages = []
  const posts = []
  const expected = new Map()
  const writes = []
  const attachments = []
  const composer = []
  let submitted = 0
  const worker = createUITestingDiscoveryWorker({
    uiTestingDiscoveryFilename: (id) => `whx_ui_test_discovery_res_${id}.zip`,
    MAX_UI_TEST_DISCOVERY_REQUEST_BYTES: 1024,
    UI_TEST_DISCOVERY_TIMEOUT_MS: 200,
    MARKDOWN_TRANSLATION_POLL_MS: 1,
    paceChatGPTWorkerSubmission: async () => {},
    chatAgentRateLimitDelayMs: () => 0,
    path,
    app: { getPath: () => '/tmp' },
    rm: async () => {}, mkdir: async () => {}, writeFile: async (filename, bytes) => { writes.push([filename, bytes.toString()]) },
    expectedChatGPTUITestDiscoveries: expected,
    reconcileChatGPTThrottleForKey: () => {},
    requireOwnedChatGPTEntry: () => ({ wc: { reload() {} } }),
    waitForChatGPTSurfaceReady: async () => {},
    targetChatGPTComposer: async () => ({ entry: {}, wc: {}, conversationUrl: '' }),
    CHATGPT_URL: 'https://chatgpt.com/',
    executeChatGPTDOMScript: async (_key, _entry, stage, script) => {
      stages.push(stage)
      if (stage.endsWith('fill')) composer.push(script)
      if (failure === 'refill' && stage.endsWith('refill')) return false
      return stage.endsWith('health') ? {} : true
    },
    chatGPTFillComposerScript: (value) => value,
    pasteChatGPTFile: async (_entry, filename) => {
      attachments.push(filename)
      if (failure === 'attachment') throw new Error('attachment failed')
      if (failure === 'sign-in') throw Object.assign(new Error('A sessão do ChatGPT precisa de autenticação humana.'), { humanAction:'authentication', retryUpload:false })
    },
    wait: async () => new Promise((resolve) => setTimeout(resolve, 1)),
    chatInputSettleDelay: () => 0,
    chatGPTAssistantTurnCount: async () => 0,
    submitChatGPTDraft: async () => { submitted += 1; return { accepted:true } },
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
  if (failure === 'sign-in') {
    const gated = await worker.discover({ task_id:taskID, attempt:0 }, {}, 'owned', payload)
    assert.deepEqual([gated.status, gated.providerWide], ['attention', true])
    assert.match(gated.error, /autenticação humana/)
    assert.equal(submitted, 0)
    assert.equal(expected.size, 0)
    return
  }
  if (failure) {
    await assert.rejects(worker.discover({ task_id:taskID, attempt:0 }, {}, 'owned', payload), /attachment|composer/)
    assert.equal(submitted, 0)
    assert.equal(posts.length, 0)
    assert.equal(expected.size, 0)
    return
  }
  const result = await worker.discover({ task_id:taskID, attempt:0 }, {}, 'owned', payload)
  assert.equal(submitted, 1)
  assert.deepEqual(writes, [[`/tmp/wharnex-ui-testing/${taskID}/${payload.request.request_filename}`, 'request-bundle']])
  assert.deepEqual(attachments, [writes[0][0]])
  assert.deepEqual(composer, [payload.bootstrap, payload.bootstrap])
  assert.equal(result.status, 'done')
  assert.equal(result.payload.tests, 2)
  assert.deepEqual(posts, [{ filename:`whx_ui_test_discovery_res_${taskID}.zip`, bundle_base64:Buffer.from('result-bundle').toString('base64') }])
  assert.equal(stages.some((stage) => stage.includes('read-answer')), false)
  assert.equal(expected.size, 0)
})


test('UI discovery refuses a request archive belonging to another task before transport', async () => {
  const worker = createUITestingDiscoveryWorker({
    uiTestingDiscoveryFilename: (id) => `whx_ui_test_discovery_res_${id}.zip`,
    MAX_UI_TEST_DISCOVERY_REQUEST_BYTES: 1024,
    paceChatGPTWorkerSubmission: () => { assert.fail('foreign request reached transport') },
  })
  const result = await worker.discover({ task_id:taskID }, {}, 'owned', {
    protocol:'wharnex.ui-test-discovery-input/v1',
    request:{ task:'discover_ui_tests', task_id:taskID,
      request_filename:`whx_ui_test_discovery_req_cat_${'b'.repeat(20)}.zip`,
      result_filename:`whx_ui_test_discovery_res_${taskID}.zip` },
    bootstrap:'Read the request bundle.', archive_base64:Buffer.from('request').toString('base64'),
  })
  assert.equal(result.status, 'failed')
})
