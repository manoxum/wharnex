import { createUITestingChat } from './chatgpt.mjs'
import { createUITestingDiscoveryWorker } from './discovery.mjs'
import { createUITestRunner } from './run.mjs'

export function createUITestingWorker(context) {
  const { BACKEND_URL, fetch } = context
  const chat = createUITestingChat(context)
  // A trailing slash on BACKEND_URL would produce "//api/...": the backend
  // answers that with a redirect without reading the body, and a large body
  // (run screenshots) then dies as a gateway 502 mid-upload.
  const backend = String(BACKEND_URL || '').replace(/\/+$/, '')
  async function post(pathname, body) {
    const response = await fetch(`${backend}/${String(pathname).replace(/^\/+/, '')}`, { method:'POST', headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' }, body:JSON.stringify(body) })
    if (!response.ok) throw new Error(`UI testing backend ${response.status}: ${(await response.text()).slice(0, 300)}`)
    return response.json()
  }
  const { discover } = createUITestingDiscoveryWorker({ ...context, post })
  const { run } = createUITestRunner({ ...context, post, chat })

  async function executeUITestingTask(task, entry, key, payload) {
    if (task.type === 'UI_TEST_DISCOVER') return discover(task, entry, key, payload)
    if (task.type === 'UI_TEST_RUN') return run(task, entry, key, payload)
    return { status:'failed', error:'unsupported UI testing task' }
  }

  return { executeUITestingTask }
}
