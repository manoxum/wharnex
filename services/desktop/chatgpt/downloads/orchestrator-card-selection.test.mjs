import assert from 'node:assert/strict'
import test from 'node:test'
import { chatGPTExpectedDownloadScript, chooseChatGPTDownloadCandidate } from './chatgpt-download-dom.mjs'

test('a later Orchestrator result wins when context increments reuse the exact filename', () => {
  const filename = 'whx_bundle_res_orchestrator_orp_20260927T144117_72c4527aecd5dbb0.zip'
  assert.deepEqual(chooseChatGPTDownloadCandidate([
    { index: 1, metadata: `${filename} Transferir`, visible: true, downloadSemantic: true },
    { index: 2, metadata: `${filename} Transferir`, visible: true, downloadSemantic: true },
  ], filename), { index: 2, mode: 'exact' })
})

test('the live download script activates the newest matching card after a Worker resumes', () => {
  const filename = 'whx_bundle_res_orchestrator_orp_20260927T144117_72c4527aecd5dbb0.zip'
  const clicked = []
  const cards = [0, 1].map((index) => ({
    textContent: `${filename} Transferir`, offsetWidth: 120,
    getAttribute: () => null, hasAttribute: () => false,
    closest() { return this }, contains: () => false,
    click: () => clicked.push(index),
  }))
  const document = {
    querySelectorAll: (selector) => selector === '[data-message-author-role="assistant"]'
      ? [{ contains: () => false }] : selector === '[data-turn-id]' ? [] : cards,
  }
  const mode = new Function('document', `return ${chatGPTExpectedDownloadScript(filename, 1)}`)(document)
  assert.equal(mode, 'exact')
  assert.deepEqual(clicked, [1])
})
