import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTComposerPoint, plannerPromptMarkdown, selectChatGPTUploadFile, waitForChatGPTReady } from './chatgpt-upload.mjs'

test('planner prompt is always materialized as a Markdown attachment', () => {
  const attachment = plannerPromptMarkdown('# Planner\n\nReturn only the bundle.')
  assert.equal(attachment.name, 'wharness-planner-prompt.md')
  assert.equal(attachment.bytes.toString('utf8'), '# Planner\n\nReturn only the bundle.\n')
})

test('ChatGPT upload uses the native file input so the canonical basename is preserved', async () => {
  const calls = []
  let attached = false
  const debuggerClient = {
    isAttached: () => attached,
    attach: (version) => { calls.push(['attach', version]); attached = true },
    detach: () => { calls.push(['detach']); attached = false },
    sendCommand: async (method, params) => {
      calls.push([method, params])
      if (method === 'Runtime.evaluate') return { result: { objectId: 'scoped-upload-input' } }
      if (method === 'DOM.requestNode') return { nodeId: 9 }
      if (method === 'DOM.setFileInputFiles') return {}
      if (method === 'DOM.resolveNode') return { object: { objectId: 'upload-object-9' } }
      if (method === 'Runtime.callFunctionOn') return { result: { value: { fileCount: 1, firstName: 'whx_bundle_req_chat-1_req_20260907T111505_example.zip' } } }
      throw new Error(`unexpected command ${method}`)
    },
  }

  const result = await selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/whx_bundle_req_chat-1_req_20260907T111505_example.zip')
  assert.equal(result.name, 'whx_bundle_req_chat-1_req_20260907T111505_example.zip')
  assert.deepEqual(calls, [
    ['attach', '1.3'],
    ['Runtime.evaluate', { expression: calls[1][1].expression, returnByValue: false }],
    ['DOM.requestNode', { objectId: 'scoped-upload-input' }],
    ['DOM.setFileInputFiles', { nodeId: 9, files: ['/tmp/whx_bundle_req_chat-1_req_20260907T111505_example.zip'] }],
    ['detach'],
  ])
  assert.equal(calls.filter(([method]) => method === 'DOM.setFileInputFiles').length, 1)
  assert.equal(calls.filter(([method]) => method === 'Runtime.callFunctionOn').length, 0, 'manually replaying input/change makes ChatGPT process the same native selection twice')
})

test('ChatGPT upload fails closed when the dedicated file input is unavailable', async () => {
  let attached = false
  const debuggerClient = {
    isAttached: () => attached,
    attach: () => { attached = true },
    detach: () => { attached = false },
    sendCommand: async (method) => {
      if (method === 'Runtime.evaluate') return { result: { value: null } }
      return method === 'DOM.getDocument' ? { root: { nodeId: 1 } } : { nodeId: 0 }
    },
  }
  await assert.rejects(() => selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/request.zip'), /file input was not found/)
  assert.equal(attached, false)
})

test('ChatGPT upload accepts the bounded general-file fallback when the stable id changes', async () => {
  let attached = false
  const calls = []
  const debuggerClient = {
    isAttached: () => attached,
    attach: () => { attached = true },
    detach: () => { attached = false },
    sendCommand: async (method, params) => {
      calls.push([method, params])
      if (method === 'Runtime.evaluate') return { result: { value: null } }
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      if (method === 'DOM.querySelector') {
        return params.selector.includes('input[type="file"][multiple]') ? { nodeId: 12 } : { nodeId: 0 }
      }
      if (method === 'DOM.setFileInputFiles') return {}
      if (method === 'DOM.resolveNode') return { object: { objectId: 'upload-object-12' } }
      if (method === 'Runtime.callFunctionOn') return { result: { value: { fileCount: 1, firstName: 'request.zip' } } }
      throw new Error(`unexpected command ${method}`)
    },
  }

  const result = await selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/request.zip')
  assert.equal(result.name, 'request.zip')
  assert.ok(calls.some(([method, params]) => method === 'DOM.querySelector' && params.selector.includes('input[type="file"][multiple]')))
})

test('a framework may clear the native FileList after selection without making the upload fail', async () => {
  const debuggerClient = {
    isAttached: () => true,
    sendCommand: async (method) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'scoped-upload-input' } }
      if (method === 'DOM.requestNode') return { nodeId: 2 }
      if (method === 'DOM.setFileInputFiles') return {}
      if (method === 'DOM.resolveNode') return { object: { objectId: 'upload-object-2' } }
      if (method === 'Runtime.callFunctionOn') return { result: { value: { fileCount: 0, firstName: '' } } }
      throw new Error(`unexpected command ${method}`)
    },
  }

  const result = await selectChatGPTUploadFile({ debugger: debuggerClient }, '/tmp/request.zip')
  assert.equal(result.name, 'request.zip')
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
