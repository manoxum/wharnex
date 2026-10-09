import test from 'node:test'
import assert from 'node:assert/strict'
import { selectChatGPTUploadFile, ChatGPTUploadCoordinator, chatGPTUploadThumbnailScript } from './chatgpt-upload.mjs'

function page() {
  const input = { name: 'live-input' }
  const staleInput = { name: 'stale-input' }
  let selected = false
  const surface = (file, live) => ({
    querySelector: (selector) => selector.startsWith('input') ? file : null,
    querySelectorAll: (selector) => live && selected && selector === 'svg' ? [{}] : [],
  })
  const composer = (root, hidden) => ({
    hidden, isConnected: true, getAttribute: () => null,
    closest: (selector) => selector === '[data-composer-surface]' ? root : null,
  })
  const stale = composer(surface(staleInput, false), true)
  const live = composer(surface(input, true), false)
  const document = {
    querySelector: () => stale,
    querySelectorAll: (selector) => selector === '#prompt-textarea' ? [stale, live] : [],
  }
  const evaluate = (script) => new Function('document', `return ${script}`)(document)
  const client = {
    isAttached: () => true,
    sendCommand: async (method, params) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: evaluate(params.expression).name } }
      if (method === 'DOM.requestNode') return { nodeId: params.objectId === input.name ? 2 : 1 }
      if (method === 'DOM.setFileInputFiles') { selected = params.nodeId === 2; return {} }
      throw new Error(`Unexpected command ${method}`)
    },
  }
  return { evaluate, client, selected: () => selected }
}

test('ZIP selection reaches the live composer even when a dormant composer has the same id', async () => {
  const fixture = page()
  await selectChatGPTUploadFile({ debugger: fixture.client }, '/tmp/whx_bundle_req_active.zip')
  assert.equal(fixture.selected(), true, 'the dormant file input cannot start a provider upload')
})

test('upload observation follows the same live composer as file selection', async () => {
  const fixture = page()
  const script = chatGPTUploadThumbnailScript('whx_bundle_req_active.zip')
  const baseline = fixture.evaluate(script)
  const coordinator = new ChatGPTUploadCoordinator()
  const upload = coordinator.expect(7, { startTimeoutMs: 20, baselineMarkerCount: baseline.markerCount })
  await selectChatGPTUploadFile({ debugger: fixture.client }, '/tmp/whx_bundle_req_active.zip')
  coordinator.onThumbnail(7, fixture.evaluate(script))
  coordinator.onThumbnail(7, fixture.evaluate(script))
  assert.equal((await upload).source, 'thumbnail-card')
})
