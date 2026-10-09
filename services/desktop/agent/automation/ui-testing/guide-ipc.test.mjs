import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUITestingGuideIPC, uiTestingGuideURL } from './guide-ipc.mjs'

const backend = 'http://127.0.0.1:6969'

test('the guide URL is derived from the backend and validated identifiers only', () => {
  assert.equal(uiTestingGuideURL(backend, { sessionId:'ses_1', runId:'run_ab_d1', format:'html' }), `${backend}/api/sessions/ses_1/ui-testing/assets/run_ab_d1/guide.html`)
  assert.equal(uiTestingGuideURL(backend, { sessionId:'ses_1', runId:'run_ab', format:'pdf' }), `${backend}/api/sessions/ses_1/ui-testing/assets/run_ab/guide.pdf`)
  for (const bad of [{ sessionId:'../x', runId:'run', format:'html' }, { sessionId:'ses_1', runId:'../../etc', format:'html' },
    { sessionId:'ses_1', runId:'run', format:'png' }, { sessionId:'ses_1', runId:'run', format:'constructor' }]) {
    assert.throws(() => uiTestingGuideURL(backend, bad))
  }
})

test('opening a guide requires a trusted sender and uses the owned browser', async () => {
  let handler
  const opened = []
  const checked = []
  registerUITestingGuideIPC({ ipcMain:{ handle:(name, fn) => { assert.equal(name, 'wharnex:ui-testing:open-guide'); handler = fn } },
    trustedSender:(event) => checked.push(event), shell:{ openExternal:async (url) => { opened.push(url) } }, backendURL:backend })
  assert.deepEqual(await handler('evt', { sessionId:'ses_1', runId:'run_x', format:'html' }), { ok:true })
  assert.deepEqual(checked, ['evt'])
  assert.deepEqual(opened, [`${backend}/api/sessions/ses_1/ui-testing/assets/run_x/guide.html`])
})
