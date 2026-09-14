import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatGPTUploadCoordinator, chatGPTComposerPoint, pasteWithUploadRetry, plannerPromptMarkdown, selectChatGPTUploadFile, waitForChatGPTReady } from './chatgpt-upload.mjs'

const uploadURL = 'https://chatgpt.com/backend-api/files/process_upload_stream'

test('planner prompt is always materialized as a Markdown attachment', () => {
  const attachment = plannerPromptMarkdown('# Planner\n\nReturn only the bundle.')
  assert.equal(attachment.name, 'wharness-planner-prompt.md')
  assert.equal(attachment.bytes.toString('utf8'), '# Planner\n\nReturn only the bundle.\n')
})

test('ChatGPT upload uses the native file input so the canonical basename is preserved', async () => {
  const calls = []
  let attached = false
  const debuggerClient = {
    isAttached: () => attached,
    attach: (version) => { calls.push(['attach', version]); attached = true },
    detach: () => { calls.push(['detach']); attached = false },
    sendCommand: async (method, params) => {
      calls.push([method, params])
      if (method === 'DOM.getDocument') return { root: { nodeId: 7 } }
      if (method === 'DOM.querySelector') return { nodeId: 9 }
      if (method === 'DOM.setFileInputFiles') return {}
      throw new Error(`unexpected command ${method}`)
    },
  }

  const result = await selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/whx_bundle_req_chat-1_req_20260907T111505_example.zip')
  assert.equal(result.name, 'whx_bundle_req_chat-1_req_20260907T111505_example.zip')
  assert.deepEqual(calls, [
    ['attach', '1.3'],
    ['DOM.getDocument', { depth: 0, pierce: false }],
    ['DOM.querySelector', { nodeId: 7, selector: 'input#upload-files, input[type="file"][data-testid*="upload" i], input[type="file"][multiple]' }],
    ['DOM.setFileInputFiles', { nodeId: 9, files: ['/tmp/whx_bundle_req_chat-1_req_20260907T111505_example.zip'] }],
    ['detach'],
  ])
})

test('ChatGPT upload fails closed when the dedicated file input is unavailable', async () => {
  let attached = false
  const debuggerClient = {
    isAttached: () => attached,
    attach: () => { attached = true },
    detach: () => { attached = false },
    sendCommand: async (method) => method === 'DOM.getDocument' ? { root: { nodeId: 1 } } : { nodeId: 0 },
  }
  await assert.rejects(() => selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/request.zip'), /file input was not found/)
  assert.equal(attached, false)
})

test('ChatGPT upload accepts the bounded general-file fallback when the stable id changes', async () => {
  let attached = false
  const calls = []
  const debuggerClient = {
    isAttached: () => attached,
    attach: () => { attached = true },
    detach: () => { attached = false },
    sendCommand: async (method, params) => {
      calls.push([method, params])
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      if (method === 'DOM.querySelector') {
        return params.selector.includes('input[type="file"][multiple]') ? { nodeId: 12 } : { nodeId: 0 }
      }
      if (method === 'DOM.setFileInputFiles') return {}
      throw new Error(`unexpected command ${method}`)
    },
  }

  const result = await selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/request.zip')
  assert.equal(result.name, 'request.zip')
  assert.ok(calls.some(([method, params]) => method === 'DOM.querySelector' && params.selector.includes('input[type="file"][multiple]')))
})

test('new-chat focus targets the centered composer instead of the conversation footer', () => {
  assert.deepEqual(chatGPTComposerPoint({ width: 1_000, height: 600 }, 'https://chatgpt.com/'), { x: 620, y: 282 })
  assert.deepEqual(chatGPTComposerPoint({ width: 1_000, height: 600 }, 'https://chatgpt.com/c/existing'), { x: 620, y: 542 })
})

test('ChatGPT readiness waits for loading to finish and for a stable network window', async () => {
  let now = 0
  let loading = true
  let lastNetworkActivity = 0
  let waits = 0

  await waitForChatGPTReady({
    isLoading: () => loading,
    lastNetworkActivity: () => lastNetworkActivity,
    now: () => now,
    stableMs: 300,
    timeoutMs: 2_000,
    wait: async (milliseconds) => {
      waits += 1
      now += milliseconds
      if (now >= 200) loading = false
      if (now === 200) lastNetworkActivity = 200
    },
  })

  assert.ok(waits > 1)
  assert.ok(now >= 500)
})

test('failed ChatGPT upload is pasted again and only resolves after confirmed success', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  let pasteCount = 0
  const retries = []

  const result = await pasteWithUploadRetry({
    attempts: 3,
    beginUpload: () => coordinator.expect(42, { startTimeoutMs: 100, completionTimeoutMs: 100 }),
    paste: async () => {
      pasteCount += 1
      const id = `upload-${pasteCount}`
      coordinator.onBeforeRequest({ id, webContentsId: 42, url: uploadURL })
      queueMicrotask(() => {
        if (pasteCount === 1) coordinator.onErrorOccurred({ id, webContentsId: 42, url: uploadURL, error: 'net::ERR_NETWORK_CHANGED' })
        else coordinator.onCompleted({ id, webContentsId: 42, url: uploadURL, statusCode: 200 })
      })
    },
    wait: async () => {},
    onRetry: (failure) => retries.push(failure),
  })

  assert.equal(pasteCount, 2)
  assert.equal(retries.length, 1)
  assert.equal(result.observed, true)
})

test('a transient composer preparation failure consumes one retry instead of aborting the upload loop', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  let preparationCount = 0
  let pasteCount = 0
  const retries = []

  const result = await pasteWithUploadRetry({
    attempts: 2,
    beforeAttempt: async () => {
      preparationCount += 1
      if (preparationCount === 1) throw new Error('ChatGPT composer DOM was not found before upload')
    },
    beginUpload: () => coordinator.expect(43, { startTimeoutMs: 100, completionTimeoutMs: 100 }),
    paste: async () => {
      pasteCount += 1
      const id = `prepared-${pasteCount}`
      coordinator.onBeforeRequest({ id, webContentsId: 43, url: uploadURL })
      queueMicrotask(() => coordinator.onCompleted({ id, webContentsId: 43, url: uploadURL, statusCode: 200 }))
    },
    wait: async () => {},
    onRetry: (failure) => retries.push(failure),
  })

  assert.equal(preparationCount, 2)
  assert.equal(pasteCount, 1)
  assert.equal(retries.length, 1)
  assert.equal(result.observed, true)
})

test('exhausted upload failures reject instead of permitting submit', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  let pasteCount = 0

  await assert.rejects(() => pasteWithUploadRetry({
    attempts: 2,
    beginUpload: () => coordinator.expect(7, { startTimeoutMs: 100, completionTimeoutMs: 100 }),
    paste: async () => {
      pasteCount += 1
      const id = `failed-${pasteCount}`
      coordinator.onBeforeRequest({ id, webContentsId: 7, url: uploadURL })
      queueMicrotask(() => coordinator.onCompleted({ id, webContentsId: 7, url: uploadURL, statusCode: 503 }))
    },
    wait: async () => {},
  }), /failed after 2 attempts/)

  assert.equal(pasteCount, 2)
})

test('a failed file selection cancels its observation before another retry starts', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  let pasteCount = 0

  await assert.rejects(() => pasteWithUploadRetry({
    attempts: 2,
    beginUpload: () => coordinator.expect(71, { startTimeoutMs: 5_000 }),
    cancelUpload: () => coordinator.cancel(71),
    paste: async () => {
      pasteCount += 1
      throw new Error('ChatGPT upload file input was not found')
    },
    wait: async () => {},
  }), /file input was not found/)

  assert.equal(pasteCount, 2)
  assert.equal(coordinator.pendingByWebContents.size, 0)
  assert.equal(coordinator.pendingByRequest.size, 0)
})

test('ChatGPT upload observation tolerates bounded upload endpoint revisions', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  const upload = coordinator.expect(44, { startTimeoutMs: 100, completionTimeoutMs: 100 })
  const details = {
    id: 'upload-v2',
    webContentsId: 44,
    method: 'POST',
    url: 'https://chatgpt.com/backend-api/uploads/file-123',
  }

  assert.equal(coordinator.onBeforeRequest(details), true)
  assert.equal(coordinator.onCompleted({ ...details, statusCode: 201 }), true)
  assert.deepEqual(await upload, { observed: true })
})

test('ChatGPT upload observation does not accept unrelated file metadata traffic', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  const upload = coordinator.expect(45, { startTimeoutMs: 20, completionTimeoutMs: 100 })

  assert.equal(coordinator.onBeforeRequest({
    id: 'metadata',
    webContentsId: 45,
    method: 'GET',
    url: 'https://chatgpt.com/backend-api/files/file-123',
  }), false)
  await assert.rejects(() => upload, /did not start the file upload before timeout/)
})
