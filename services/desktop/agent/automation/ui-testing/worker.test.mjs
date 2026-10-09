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

test('one UI test run holds the persistent Worker cap; a second claim waits for free', async () => {
  const { uiTestRunSlots } = await import('./capacity.mjs')
  let release
  const refused = { ok:false, status:418, text: async () => 'stop' }
  const held = new Promise((resolve) => { release = () => resolve(refused) })
  const { executeUITestingTask } = createUITestingWorker({
    BACKEND_URL: 'http://backend:8080', BrowserWindow: FakeWindow, path, app:{ getPath: () => '/tmp' }, rm: async () => {}, mkdir: async () => {},
    fetch: () => held,
  })
  const payload = { protocol:'harness.ui-test-run/v2', run_id:'run_x', environment:{ id:'web', url:'https://app.test/' }, profile:{ id:'admin' }, full_chain:[], chain:[] }
  const first = executeUITestingTask({ type:'UI_TEST_RUN', task_id:'cat_a' }, {}, 'k', payload)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(uiTestRunSlots.excludedTypes(), ['UI_TEST_RUN'], 'the Worker claim excludes further runs')
  const second = await executeUITestingTask({ type:'UI_TEST_RUN', task_id:'cat_b' }, {}, 'k', payload)
  assert.deepEqual([second.status, second.observation], ['waiting', true])
  release()
  await first
  assert.equal(uiTestRunSlots.active(), 0)
})
