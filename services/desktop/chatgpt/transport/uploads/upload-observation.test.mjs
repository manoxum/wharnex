import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatGPTUploadCoordinator, chatGPTUploadThumbnailScript } from './chatgpt-upload.mjs'

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

test('staged ChatGPT upload waits for the uploaded acknowledgement, not metadata creation', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  const upload = coordinator.expect(46, { startTimeoutMs: 100, completionTimeoutMs: 100 })
  const metadata = {
    id: 'upload-metadata',
    webContentsId: 46,
    method: 'POST',
    url: 'https://chatgpt.com/backend-api/files',
  }

  assert.equal(coordinator.onBeforeRequest(metadata), true)
  assert.equal(coordinator.onCompleted({ ...metadata, statusCode: 201 }), true)
  assert.equal(coordinator.pendingByWebContents.has(46), true)

  const uploaded = {
    id: 'upload-complete',
    webContentsId: 46,
    method: 'POST',
    url: 'https://chatgpt.com/backend-api/files/file-123/uploaded',
  }
  assert.equal(coordinator.onBeforeRequest(uploaded), true)
  assert.equal(coordinator.onCompleted({ ...uploaded, statusCode: 200 }), true)
  assert.deepEqual(await upload, { observed: true })
})

test('ChatGPT upload start timeout defaults to 20s, not the old 8s that live testing showed was too tight under two-Worker contention', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  // A real 20s wait would make the suite slow for no benefit; a fake clock
  // exercises the same setTimeout(..., startTimeoutMs) path deterministically.
  const originalSetTimeout = globalThis.setTimeout
  let scheduledMs = 0
  globalThis.setTimeout = (fn, ms) => { scheduledMs = ms; return originalSetTimeout(fn, 0) }
  try {
    await assert.rejects(() => coordinator.expect(48), /did not start the file upload before timeout/)
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
  assert.equal(scheduledMs, 20_000)
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

test('the composer upload thumbnail reports its percentage and completed state without reading response prose', async () => {
  const script = chatGPTUploadThumbnailScript('request.zip')
  assert.match(script, /aria-valuenow/)
  assert.match(script, /animate-spin/)
  assert.match(script, /data-composer-surface/)
  assert.match(script, /data-file-name/)
  assert.match(script, /complete|completed|uploaded/)
  assert.doesNotMatch(script, /textContent|innerText|document\.cookie|localStorage|sessionStorage/)
  assert.doesNotThrow(() => new Function(script))
})

test('the new indeterminate upload thumbnail confirms completion when its spinner disappears', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  const progress = []
  const upload = coordinator.expect(49, { startTimeoutMs: 100, completionTimeoutMs: 100, onProgress: (value) => progress.push(value) })
  assert.equal(coordinator.onThumbnail(49, { visible: true, progress: null, active: true, complete: false }, (value) => progress.push(value)), true)
  assert.equal(coordinator.onThumbnail(49, { visible: true, progress: null, active: false, complete: false }, (value) => progress.push(value)), true)
  assert.deepEqual(await upload, { observed: true, progress: 100, source: 'thumbnail-spinner' })
  assert.deepEqual(progress, [])
})

test('a persistent new preview confirms upload when a short-lived spinner was missed', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  const upload = coordinator.expect(50, { startTimeoutMs: 100, completionTimeoutMs: 100, baselineMarkerCount: 4 })
  assert.equal(coordinator.onThumbnail(50, { visible: true, markerCount: 5, active: false, complete: false }), true)
  assert.equal(coordinator.onThumbnail(50, { visible: true, markerCount: 5, active: false, complete: false }), true)
  assert.deepEqual(await upload, { observed: true, progress: 100, source: 'thumbnail-card' })
})

test('an unchanged composer never treats its existing previews as a new upload', async () => {
  const coordinator = new ChatGPTUploadCoordinator()
  const upload = coordinator.expect(51, { startTimeoutMs: 10, completionTimeoutMs: 100, baselineMarkerCount: 4 })
  assert.equal(coordinator.onThumbnail(51, { visible: true, markerCount: 4, active: false, complete: false }), true)
  await assert.rejects(() => upload, /did not start the file upload before timeout/)
})
