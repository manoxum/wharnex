import test from 'node:test'
import assert from 'node:assert/strict'
import { selectChatGPTUploadFile } from './chatgpt-upload.mjs'

test('ZIP upload selects the general-file input ahead of the new media inputs', async () => {
  const calls = []
  const debuggerClient = {
    isAttached: () => true,
    sendCommand: async (method, params) => {
      calls.push([method, params])
      if (method === 'Runtime.evaluate') return { result: { value: null } }
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      if (method === 'DOM.querySelector') {
        if (params.selector.includes(':not([accept])')) return { nodeId: 30 }
        if (params.selector.includes('[multiple]')) return { nodeId: 10 }
        return { nodeId: 0 }
      }
      if (method === 'DOM.setFileInputFiles') return {}
      throw new Error(`unexpected command ${method}`)
    },
  }

  await selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/whx_bundle_req_test.zip')

  const selected = calls.find(([method]) => method === 'DOM.setFileInputFiles')
  assert.equal(selected?.[1]?.nodeId, 30)
  const queried = calls.filter(([method]) => method === 'DOM.querySelector').map(([, params]) => params.selector)
  const generalIndex = queried.indexOf('form[data-chatgpt-composer] input[type="file"]:not([accept])')
  const genericIndex = queried.findIndex((selector) => selector.includes('[multiple]'))
  assert.ok(generalIndex >= 0)
  assert.ok(genericIndex < 0 || generalIndex < genericIndex)
})
