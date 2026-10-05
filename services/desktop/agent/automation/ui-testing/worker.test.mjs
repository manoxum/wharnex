import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createUITestingWorker } from './worker.mjs'

class FakeWindow {
  constructor() { this.webContents = { session:{ clearStorageData: async () => {} } } }
  isDestroyed() { return false }
  destroy() {}
}

test('backend calls never produce a double slash, whatever BACKEND_URL ends with', async () => {
  for (const base of ['http://backend:8080/', 'http://backend:8080']) {
    const urls = []
    const { executeUITestingTask } = createUITestingWorker({
      BACKEND_URL: base, BrowserWindow: FakeWindow, path, app:{ getPath: () => '/tmp' }, rm: async () => {}, mkdir: async () => {},
      fetch: async (url) => { urls.push(url); return { ok:false, status:418, text: async () => 'stop' } },
    })
    await executeUITestingTask({ type:'UI_TEST_RUN', task_id:'cat_x' }, {}, 'k',
      { protocol:'harness.ui-test-run/v2', run_id:'run_x', environment:{ id:'web', url:'https://app.test/' }, profile:{ id:'admin' }, full_chain:[], chain:[] })
    assert.ok(urls.length > 0)
    for (const url of urls) assert.equal(url.startsWith('http://backend:8080/api/ui-testing/tasks/cat_x/'), true, url)
  }
})
