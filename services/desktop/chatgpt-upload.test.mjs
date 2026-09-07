import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatGPTUploadCoordinator, chatGPTComposerPoint, pasteWithUploadRetry, plannerPromptMarkdown, waitForChatGPTReady } from './chatgpt-upload.mjs'

const uploadURL = 'https://chatgpt.com/backend-api/files/process_upload_stream'

test('planner prompt is always materialized as a Markdown attachment', () => {
  const attachment = plannerPromptMarkdown('# Planner\n\nReturn only the bundle.')
  assert.equal(attachment.name, 'wharness-planner-prompt.md')
  assert.equal(attachment.bytes.toString('utf8'), '# Planner\n\nReturn only the bundle.\n')
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
