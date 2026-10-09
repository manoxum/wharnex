import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTFileUpload } from './paste-runtime.mjs'

function fixture({ cooldown = 0, ready = true, gate = '' } = {}) {
  const events = []
  const wc = { id: 7, executeJavaScript: async (script) => script === 'composer' ? ready : script === 'health' ? { required: Boolean(gate), kind: gate } : { markerCount: 2 } }
  const entry = { view: { webContents: wc } }
  class Deferral extends Error { constructor(delayMs) { super('deferred'); this.delayMs = delayMs } }
  const { pasteChatGPTFile } = createChatGPTFileUpload({
    chatGPTKeyForEntry: () => 'chat-1',
    requireOwnedChatGPTEntry: () => ({ wc }),
    pasteWithUploadRetry: async (options) => {
      await options.beforeAttempt()
      const upload = options.beginUpload()
      assert.equal(upload.baselineMarkerCount, 2)
      await options.paste()
      return { observed: true }
    },
    paceChatGPTWorkerSubmission: async () => events.push('pace'),
    chatAgentRateLimitDelayMs: () => cooldown,
    ChatGPTRateLimitDeferral: Deferral,
    chatAgentWorkerActivity: { set: (state) => events.push(state) },
    waitForChatGPTSurfaceReady: async () => events.push('ready'),
    chatGPTComposerReadyScript: () => 'composer',
    chatGPTUploadThumbnailScript: () => 'thumbnail',
    path: { basename: () => 'request.zip' },
    chatGPTUploads: { expect: () => ({ baselineMarkerCount: 2 }), cancel: () => events.push('cancel') },
    selectChatGPTUploadFile: async () => events.push('select'),
    chatGPTHumanActionScript: () => 'health',
    setChatGPTHumanAction: (key, kind) => events.push(`human:${key}:${kind}`),
    chatGPTHumanActionMessage: (kind) => `needs ${kind}`,
  })
  return { pasteChatGPTFile, entry, events, Deferral }
}

test('Worker upload checks the shared gate before selecting a file', async () => {
  const { pasteChatGPTFile, entry, events, Deferral } = fixture({ cooldown: 20_000 })
  await assert.rejects(pasteChatGPTFile(entry, '/tmp/request.zip', 1, 1, { pacedWorker: true }), Deferral)
  assert.deepEqual(events, ['pace'])
})

test('confirmed upload observes the composer and selects the exact request archive', async () => {
  const { pasteChatGPTFile, entry, events } = fixture()
  await pasteChatGPTFile(entry, '/tmp/request.zip', 1, 1, { pacedWorker: true })
  assert.deepEqual(events, ['pace', 'uploading', 'ready', 'select'])
})

test('missing composer blocks file selection', async () => {
  const { pasteChatGPTFile, entry, events } = fixture({ ready: false })
  await assert.rejects(pasteChatGPTFile(entry, '/tmp/request.zip', 1, 1), /composer DOM was not found/)
  assert.ok(!events.includes('select'))
})

test('a sign-in gate stops the upload as non-retryable human attention before selection', async () => {
  const { pasteChatGPTFile, entry, events } = fixture({ gate: 'authentication' })
  const error = await pasteChatGPTFile(entry, '/tmp/request.zip', 1, 1, { pacedWorker: true }).catch((reason) => reason)
  assert.equal(error.humanAction, 'authentication')
  assert.equal(error.retryUpload, false)
  assert.equal(error.message, 'needs authentication')
  assert.ok(events.includes('human:chat-1:authentication'))
  assert.ok(!events.includes('select'))
})
