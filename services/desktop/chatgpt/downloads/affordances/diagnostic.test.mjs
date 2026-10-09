import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTExpectedDownloadDiagnosticScript, normalizeDownloadDiagnostic } from './index.mjs'
import { chatGPTExpectedDownloadScript } from '../chatgpt-download-dom.mjs'

function page() {
  let clicks = 0
  const control = { tagName: 'BUTTON', textContent: 'whx_bundle_res_owned_req.zip', offsetWidth: 10, getAttribute: (name) => name === 'aria-label' ? 'Transferir' : '', hasAttribute: () => false, closest: () => null, contains: () => false, click: () => { clicks += 1 } }
  const turn = { contains: (node) => node === control, closest: () => null }
  const document = { querySelectorAll: (selector) => selector === '[data-message-author-role="assistant"]' ? [turn] : selector.includes('a[download]') ? [control] : [] }
  const run = (source) => new Function('document', `return ${source}`)(document)
  return { run, document, clicks: () => clicks }
}

test('passive exact-download diagnostics report the runtime decision without clicking or exposing prose', () => {
  const f = page()
  const result = f.run(chatGPTExpectedDownloadDiagnosticScript('whx_bundle_res_owned_req.zip'))
  assert.equal(result.state, 'ready')
  assert.equal(result.exact, 1)
  assert.equal(result.mode, 'exact')
  assert.equal(result.resources.mainFound, false)
  assert.equal(f.clicks(), 0)
  assert.doesNotMatch(JSON.stringify(result), /whx_bundle|Transferir|https:|textContent|metadata/)
})

test('runtime keeps its string contract and optionally reports diagnostics from the same single scan', () => {
  const f = page()
  assert.equal(f.run(chatGPTExpectedDownloadScript('whx_bundle_res_owned_req.zip')), 'exact')
  const result = f.run(chatGPTExpectedDownloadScript('whx_bundle_res_owned_req.zip', 0, false, false, { diagnostics: true }))
  assert.equal(result.mode, 'exact')
  assert.equal(result.diagnostic.state, 'ready')
  assert.equal(f.clicks(), 2)
})

test('the main-process diagnostic boundary drops arbitrary page strings and caps rows and dimensions', () => {
  const result = normalizeDownloadDiagnostic({ state: 'ready', mode: 'exact', exact: 1, prose: 'secret answer', controls: Array(50).fill({ tag: 'button', role: 'button', testid: 'download', metadata: 'secret answer', href: 'https://provider/file', exact: true }) })
  assert.equal(result.controls.length, 16)
  assert.doesNotMatch(JSON.stringify(result), /secret|https:|metadata|href/)
})

test('resource-shape diagnosis failure cannot prevent a previously selected exact download', () => {
  const f = page()
  f.document.querySelector = () => { throw new Error('resource-shape unavailable') }
  const result = f.run(chatGPTExpectedDownloadScript('whx_bundle_res_owned_req.zip', 0, false, false, { diagnostics: true }))
  assert.equal(result.mode, 'exact')
  assert.equal(f.clicks(), 1)
  assert.equal(result.diagnostic.resources.unavailable, true)
})
