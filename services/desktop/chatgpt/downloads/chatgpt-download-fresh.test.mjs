import assert from 'node:assert/strict'
import test from 'node:test'
import { chatGPTExpectedDownloadScript } from './chatgpt-download-dom.mjs'
import { pollWorkerExpectedDownload } from '../../agent/automation/chat-agent-download-poll.mjs'

test('a repair waits for a file in the new assistant turn', () => {
  const filename = 'whx_bundle_res_task_request.zip'
  let clicks = 0
  const card = {
    textContent: filename, offsetWidth: 120,
    getAttribute: () => null, hasAttribute: () => false,
    closest: () => card, contains: (node) => node === button,
  }
  const button = {
    textContent: 'Transferir', offsetWidth: 20,
    getAttribute: () => null, hasAttribute: () => false,
    closest: () => card, contains: () => false,
    click: () => { clicks += 1 },
  }
  const previous = { contains: (node) => node === card || node === button }
  const current = { contains: () => false, closest: () => null }
  const turns = [previous, current]
  const document = {
    querySelectorAll: (selector) => selector === '[data-message-author-role="assistant"]' ? turns
      : selector === '[data-turn-id]' ? [] : [card, button],
  }
  const run = () => new Function('document', `return ${chatGPTExpectedDownloadScript(filename, 1, true)}`)(document)
  assert.equal(run(), '')
  assert.equal(clicks, 0)
  current.contains = (node) => node === card || node === button
  assert.equal(run(), 'exact')
  assert.equal(clicks, 1)
})

test('Worker download poll carries the fresh-turn requirement after repair', async () => {
  const expected = { filename: 'whx_bundle_res_task_request.zip', assistantBaseline: 1, freshOnly: true }
  const args = []
  await pollWorkerExpectedDownload(expected, async () => '', (...values) => { args.push(values); return '' }, 100_000)
  assert.deepEqual(args, [[expected.filename, 1, true]])
})

test('a whole-conversation search clicks only a control naming the exact file', () => {
  const exactOnly = chatGPTExpectedDownloadScript('whx_bundle_res_otk-a_req_1.zip', 0, false, true)
  assert.match(exactOnly, /if \(true && decision\.mode !== 'exact'\) return ''/)
  assert.match(chatGPTExpectedDownloadScript('whx_bundle_res_otk-a_req_1.zip'), /if \(false && decision\.mode !== 'exact'\) return ''/)
})
