import assert from 'node:assert/strict'
import test from 'node:test'
import { captureChatGPTAgentPage, captureParkedWorkerPage } from './chat-agent-snapshot.mjs'

function browser({ capture, screenshot } = {}) {
  const calls = []
  const wc = {
    capturePage: (...args) => { calls.push(['capturePage', ...args]); return capture?.() },
    debugger: {
      isAttached: () => false,
      attach: (version) => calls.push(['attach', version]),
      sendCommand: (command, options) => { calls.push(['sendCommand', command, options]); return screenshot?.() },
      detach: () => calls.push(['detach']),
    },
  }
  return { wc, calls }
}

test('parked Worker captures its renderer without waiting for a compositor frame or changing viewport', async () => {
  const { wc, calls } = browser({ screenshot: async () => ({ data: 'AA==' }) })
  const dataUrl = await captureChatGPTAgentPage(wc, { parked: true })
  assert.equal(dataUrl, 'data:image/png;base64,AA==')
  assert.equal(calls.some(([name]) => name === 'capturePage'), false)
  assert.deepEqual(calls.find(([name]) => name === 'sendCommand'), [
    'sendCommand', 'Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false },
  ])
  assert.equal(calls.at(-1)[0], 'detach')
})

test('visible browser requests a hidden-safe compositor frame first', async () => {
  const { wc, calls } = browser({ capture: async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,BB==' }) })
  assert.equal(await captureChatGPTAgentPage(wc), 'data:image/png;base64,BB==')
  assert.deepEqual(calls, [['capturePage', undefined, { stayHidden: true }]])
})

test('a stalled compositor falls back within its deadline', async () => {
  const { wc, calls } = browser({ capture: () => new Promise(() => {}), screenshot: async () => ({ data: 'CC==' }) })
  assert.equal(await captureChatGPTAgentPage(wc, { compositorDeadlineMs: 5 }), 'data:image/png;base64,CC==')
  assert.equal(calls.some(([name]) => name === 'sendCommand'), true)
})

test('a stalled renderer fails in bounded time and releases its debugger', async () => {
  const { wc, calls } = browser({ screenshot: () => new Promise(() => {}) })
  await assert.rejects(captureChatGPTAgentPage(wc, { parked: true, rendererDeadlineMs: 5 }), /Captura do renderer excedeu 5 ms/)
  assert.equal(calls.at(-1)[0], 'detach')
})

test('a hidden Worker becomes visible at full size for capture and is restored afterward', async () => {
  const calls = []
  const entry = { view: { webContents: {} } }
  const image = await captureParkedWorkerPage(entry, class BrowserWindow {}, {
    openMonitor: () => calls.push('open'), closeMonitor: () => calls.push('close'),
    wait: async () => calls.push('settle'),
    capture: async (_wc, options) => { calls.push(options); return 'data:image/png;base64,DD==' },
  })
  assert.equal(image, 'data:image/png;base64,DD==')
  assert.deepEqual(calls, ['open', 'settle', { parked: false, compositorDeadlineMs: 4000 }, 'close'])
})

test('capture leaves an already opened Worker monitor visible', async () => {
  const calls = []
  const entry = { monitorWindow: { isDestroyed: () => false }, view: { webContents: {} } }
  await captureParkedWorkerPage(entry, class BrowserWindow {}, {
    openMonitor: () => calls.push('open'), closeMonitor: () => calls.push('close'),
    capture: async () => 'data:image/png;base64,EE==',
  })
  assert.deepEqual(calls, [])
})
