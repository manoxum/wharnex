import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTExpectedDownloadScript } from './chatgpt-download-dom.mjs'

test('a submitted bootstrap naming the expected ZIP cannot be clicked as a response', () => {
  const filename = 'whx_bundle_res_owned_req.zip'
  let clicks = 0
  const user = { matches: () => true }
  const control = {
    textContent: `Read input.zip and return ${filename}`, offsetWidth: 20,
    getAttribute: () => null, hasAttribute: () => false,
    closest: (selector) => selector.includes('group/user-message') ? user : null,
    contains: () => false, click: () => { clicks += 1 },
  }
  const document = { querySelectorAll: (selector) => selector.includes('a[download]') ? [control] : [] }
  const mode = new Function('document', `return ${chatGPTExpectedDownloadScript(filename)}`)(document)
  assert.equal(mode, '')
  assert.equal(clicks, 0)
})

test('fresh response capture recognizes the current provider turn marker', () => {
  const filename = 'whx_bundle_res_owned_req.zip'
  let clicks = 0
  const control = { textContent: filename, offsetWidth: 20, getAttribute: () => null,
    hasAttribute: () => false, closest: () => null, contains: () => false, click: () => { clicks += 1 } }
  const turn = { contains: (node) => node === control }
  const marker = { parentElement: turn }
  const document = { querySelectorAll: (selector) => selector === '[data-chatgpt-agent-turn-start]' ? [marker]
    : selector.includes('a[download]') ? [control] : [] }
  const mode = new Function('document', `return ${chatGPTExpectedDownloadScript(filename, 0, true)}`)(document)
  assert.equal(mode, 'exact')
  assert.equal(clicks, 1)
})
