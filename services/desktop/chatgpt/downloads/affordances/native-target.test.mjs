import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTExpectedDownloadScript, chatGPTExpectedDownloadDiagnosticScript, chatGPTExactRoleLinkTargetScript } from './index.mjs'

const filename = 'whx_bundle_res_owned_req_current.zip'
function fixture({ offscreen = false, blocked = false } = {}) {
  let scrolls = 0
  let clicks = 0
  let left = offscreen ? 900 : 20
  const node = { tagName: 'SPAN', offsetWidth: 30, offsetHeight: 10, closest: () => null, contains: () => false, getAttribute: (field) => ({ role: 'link', 'aria-label': filename })[field] || null, hasAttribute: () => false, getBoundingClientRect: () => ({ left, top: 40, width: 30, height: 10 }), scrollIntoView: () => { scrolls += 1; left = 20 }, click: () => { clicks += 1 } }
  const main = { contains: (value) => value === node }
  const document = { defaultView: { innerWidth: 800, innerHeight: 600 }, querySelector: () => main, elementFromPoint: () => blocked ? {} : node, querySelectorAll: (selector) => selector.startsWith('a[download]') || selector.startsWith('[role="link"]') ? [node] : [] }
  const run = (script) => new Function('document', `return ${script}`)(document)
  return { run, node, document, scrolls: () => scrolls, clicks: () => clicks }
}

test('structured role-link activation returns a native point without a synthetic click', () => {
  const f = fixture()
  const result = f.run(chatGPTExpectedDownloadScript(filename, 0, false, true, { diagnostics: true }))
  assert.equal(result.nativeTarget.kind, 'exact-role-link')
  assert.deepEqual(result.nativeTarget.rect, { x: 35, y: 45 })
  assert.equal(f.clicks(), 0)
})

test('only the exact activation target may scroll; passive diagnosis and legacy strings do not', () => {
  const f = fixture({ offscreen: true })
  f.run(chatGPTExpectedDownloadDiagnosticScript(filename))
  assert.equal(f.scrolls(), 0)
  assert.equal(f.run(chatGPTExpectedDownloadScript(filename)), '')
  assert.equal(f.scrolls(), 0)
  const result = f.run(chatGPTExpectedDownloadScript(filename, 0, false, true, { diagnostics: true }))
  assert.equal(result.nativeTarget.rect.x, 35)
  assert.equal(f.scrolls(), 1)
  assert.equal(f.clicks(), 0)
})

test('a covered exact role-link returns an unavailable target rather than clicking another control', () => {
  const f = fixture({ blocked: true })
  const result = f.run(chatGPTExpectedDownloadScript(filename, 0, false, true, { diagnostics: true }))
  assert.equal(result.nativeTarget.kind, 'exact-role-link')
  assert.equal(result.nativeTarget.rect, null)
  assert.equal(result.mode, '')
  assert.equal(f.clicks(), 0)
})

test('legacy string callers retain a working exact button when native role-links are also present', () => {
  const f = fixture()
  let clicked = 0
  const button = { tagName: 'BUTTON', offsetWidth: 20, textContent: filename, getAttribute: (field) => field === 'role' ? 'button' : '', hasAttribute: () => false, closest: () => null, contains: () => false, click: () => { clicked += 1 } }
  f.document.querySelectorAll = (selector) => selector.startsWith('a[download]') ? [button, f.node] : []
  assert.equal(f.run(chatGPTExpectedDownloadScript(filename)), 'exact')
  assert.equal(clicked, 1)
  assert.equal(f.clicks(), 0)
})

test('the named native locator revalidates exact attributes after scrolling and refuses missing controls', () => {
  const f = fixture({ offscreen: true })
  f.node.scrollIntoView = () => { f.node.getAttribute = () => '' }
  assert.equal(f.run(chatGPTExactRoleLinkTargetScript(filename)).rect, null)
  f.document.querySelectorAll = () => []
  assert.equal(f.run(chatGPTExactRoleLinkTargetScript(filename)).rect, null)
  assert.equal(f.clicks(), 0)
})
