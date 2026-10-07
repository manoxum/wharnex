import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatGPTUploadCoordinator, pasteWithUploadRetry } from './chatgpt-upload.mjs'

const uploadURL = 'https://chatgpt.com/backend-api/files/process_upload_stream'

test('an explicit ChatGPT upload rejection is pasted again and only resolves after confirmed success', async () => {
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
        if (pasteCount === 1) coordinator.onCompleted({ id, webContentsId: 42, url: uploadURL, statusCode: 503 })
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

test('an ambiguous upload network failure never selects the same file twice', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  let pasteCount = 0
  const retries = []

  await assert.rejects(() => pasteWithUploadRetry({
    attempts: 3,
    beginUpload: () => coordinator.expect(42, { startTimeoutMs: 100, completionTimeoutMs: 100 }),
    paste: async () => {
      pasteCount += 1
      const id = `ambiguous-${pasteCount}`
      coordinator.onBeforeRequest({ id, webContentsId: 42, url: uploadURL })
      queueMicrotask(() => coordinator.onErrorOccurred({ id, webContentsId: 42, url: uploadURL, error: 'net::ERR_NETWORK_CHANGED' }))
    },
    wait: async () => {},
    onRetry: (failure) => retries.push(failure),
  }), /state is uncertain/i)

  assert.equal(pasteCount, 1)
  assert.equal(retries.length, 0)
})

test('an upload completion timeout never selects the same file twice', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  let pasteCount = 0

  await assert.rejects(() => pasteWithUploadRetry({
    attempts: 2,
    beginUpload: () => coordinator.expect(44, { startTimeoutMs: 20, completionTimeoutMs: 5 }),
    paste: async () => {
      pasteCount += 1
      coordinator.onBeforeRequest({ id: `timeout-${pasteCount}`, webContentsId: 44, url: uploadURL })
    },
    wait: async () => {},
  }), /state is uncertain/i)

  assert.equal(pasteCount, 1)
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

test('a deliberate pre-flight deferral escapes without upload retries or error wrapping', async () => {
  const deferred = new Error('provider cooldown is active')
  deferred.retryUpload = false
  let preparationCount = 0
  let pasteCount = 0
  const retries = []

  await assert.rejects(() => pasteWithUploadRetry({
    attempts: 5,
    beforeAttempt: async () => {
      preparationCount += 1
      throw deferred
    },
    beginUpload: () => Promise.resolve({ observed: true }),
    paste: async () => { pasteCount += 1 },
    wait: async () => {},
    onRetry: (failure) => retries.push(failure),
  }), (error) => error === deferred)

  assert.equal(preparationCount, 1)
  assert.equal(pasteCount, 0)
  assert.equal(retries.length, 0)
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

test('the account upload limit stops the local retries at the second upload that never started', async () => {
  const { createChatGPTUploadLimitGate, ChatGPTUploadLimitDeferral } = await import('../../session/health/upload-limit.mjs')
  const gate = createChatGPTUploadLimitGate({ log: () => {} })
  let selections = 0
  await assert.rejects(pasteWithUploadRetry({
    beginUpload: () => Promise.reject(new Error('ChatGPT did not start the file upload before timeout')),
    paste: async () => { selections += 1 },
    wait: async () => {},
    classifyFailure: async (error) => (/did not start/.test(error.message) ? gate.noteNotStarted(7) : null),
  }), (error) => error instanceof ChatGPTUploadLimitDeferral && error.freeDeferral === true)
  assert.equal(selections, 2)
  assert.equal(gate.admit(9).allowed, false)
})
