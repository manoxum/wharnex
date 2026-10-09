import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTDownloadRouter } from './router.mjs'

class BundleOwnershipError extends Error {
  constructor(requestId, filename) {
    super('wrong chat')
    this.requestId = requestId
    this.filename = filename
  }
}

function routerHarness({ classify = () => undefined, expected = undefined } = {}) {
  let listener
  const calls = []
  const { registerChatGPTPlanDownloads } = createChatGPTDownloadRouter({
    chatGPTWorkerEntries: [], chatAgentWorkerActivity: { setFor: () => undefined },
    registerOrchestratorExecutionDownload: () => false,
    expectedChatGPTOrchestratorExecutions: new Map(), tempPath: () => '/tmp',
    registerChatGPTOrchestratorPlanDownload: () => false,
    registerChatGPTMarkdownTranslationDownload: () => false,
    registerReleaseNotesBundleDownload: () => false,
    expectedChatGPTReleaseNotes: new Map(),
    registerChatGPTTodoClassificationDownload: () => false,
    expectedChatGPTBundleForDownload: () => expected,
    chatGPTKeyForWebContents: () => 'visible-chat',
    canonicalWharnexBundleDownload: classify,
    BundleOwnershipError, path: { basename: (value) => value.split('/').at(-1) },
    publishBundleDownloadError: (...args) => calls.push(['error', ...args]),
    handleBundleDownload: (...args) => calls.push(['bundle', ...args]),
    handleLegacyPlanDownload: (...args) => calls.push(['legacy', ...args]),
  })
  registerChatGPTPlanDownloads({ on: (name, handler) => { assert.equal(name, 'will-download'); listener = handler } })
  const item = (filename) => ({
    getFilename: () => filename, getMimeType: () => 'application/zip',
    cancel: () => calls.push(['cancel']),
  })
  return { calls, item, receive: (download) => listener({}, download, {}) }
}

test('a valid response bundle reaches the strict bundle handler with its expectation', () => {
  const expected = { key: 'chat-1', requestId: 'req-1', filename: 'whx_bundle_res_chat-1_req-1.zip' }
  const candidate = { requestId: 'req-1', filename: expected.filename }
  const { calls, item, receive } = routerHarness({ classify: () => candidate, expected })
  receive(item(candidate.filename))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'bundle')
  assert.equal(calls[0][5], 'chat-1')
  assert.equal(calls[0][6], candidate)
})

test('a cross-request bundle stays unrouted for durable request-id delivery', () => {
  const filename = 'whx_bundle_res_other_req-2.zip'
  const { calls, item, receive } = routerHarness({
    expected: { key: 'chat-1', requestId: 'req-1' },
    classify: () => { throw new BundleOwnershipError('req-2', filename) },
  })
  receive(item(filename))
  assert.equal(calls[0][0], 'bundle')
  assert.equal(calls[0][6].unrouted, true)
  assert.equal(calls[0][6].requestId, 'req-2')
  assert.equal(calls.some(([kind]) => kind === 'cancel'), false)
})

test('invalid bundle names and ownership errors cancel before fallback', () => {
  const invalid = routerHarness()
  invalid.receive(invalid.item('whx_bundle_res_spoof.zip'))
  assert.deepEqual(invalid.calls.map(([kind]) => kind), ['cancel', 'error'])

  const mismatched = routerHarness({ classify: () => { throw new Error('invalid request') } })
  mismatched.receive(mismatched.item('whx_bundle_res_chat-1_req-1.zip'))
  assert.deepEqual(mismatched.calls.map(([kind]) => kind), ['cancel', 'error'])

  const unknown = routerHarness()
  unknown.receive(unknown.item('unrelated.bin'))
  assert.deepEqual(unknown.calls.map(([kind]) => kind), ['legacy'])
})
