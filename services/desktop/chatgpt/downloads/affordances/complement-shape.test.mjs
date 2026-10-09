import test from 'node:test'
import assert from 'node:assert/strict'
import { describeOwnedResourceShape, normalizeOwnedResourceShape } from './resource-shape.mjs'
import { describeComplementaryControlShape } from './complement-shape.mjs'
import { chatGPTExpectedDownloadScript } from './index.mjs'

const expected = 'whx_bundle_res_owned_req_current.zip'
function fixture() {
  const link = { tagName: 'SPAN', offsetWidth: 20, offsetHeight: 10, closest: () => null, getAttribute: (field) => ({ role: 'link', 'data-filename': expected })[field] || null, hasAttribute: (field) => field === 'data-filename' }
  for (const field of ['textContent', 'href']) Object.defineProperty(link, field, { get() { throw new Error(`forbidden ${field}`) } })
  const main = { contains: () => true, scrollTop: 40, scrollHeight: 1200, clientHeight: 600 }
  const root = { scrollTop: 0, scrollHeight: 1300, clientHeight: 700 }
  const document = { defaultView: { innerWidth: 1280, innerHeight: 720 }, scrollingElement: root, querySelector: () => main, querySelectorAll: (selector) => selector.startsWith('[role="link"]') ? [link] : [] }
  return { document, link }
}

test('a role-link filename control outside capture is observed passively without text or href reads', () => {
  const f = fixture()
  const result = describeOwnedResourceShape(f.document, [], [], expected, describeComplementaryControlShape)
  assert.equal(result.complement.outsideCapture, 1)
  assert.equal(result.complement.expected, 1)
  assert.equal(result.complement.visible, 1)
  assert.equal(result.complement.controls[0].role, 'link')
  assert.deepEqual(result.complement.viewport, { width: 1280, height: 720 })
  assert.equal(result.complement.mainScroll.top, 40)
  assert.doesNotMatch(JSON.stringify(result), /whx_bundle|data-filename|https:/)
})

test('covered and input controls remain distinct and diagnostic rows/dimensions are bounded', () => {
  const f = fixture()
  const covered = describeOwnedResourceShape(f.document, [f.link], [], expected, describeComplementaryControlShape)
  assert.equal(covered.complement.outsideCapture, 0)
  f.link.closest = () => ({})
  assert.equal(describeOwnedResourceShape(f.document, [], [], expected, describeComplementaryControlShape).complement.total, 0)
  const result = normalizeOwnedResourceShape({ complement: { controls: Array(200).fill({ tag: 'span', role: 'link', label: 'secret', expected: true }), viewport: { width: Infinity, height: -10 }, rootScroll: { top: 10, prose: 'secret' }, prose: 'secret' } })
  assert.equal(result.complement.controls.length, 16)
  assert.deepEqual(result.complement.viewport, { width: 0, height: 0 })
  assert.doesNotMatch(JSON.stringify(result), /secret/)
})

test('the closed supplemental scan inspects at most 128 controls and never activates or scrolls', () => {
  const f = fixture()
  f.document.querySelectorAll = (selector) => selector.startsWith('[role="link"]') ? Array(200).fill(f.link) : []
  const result = describeOwnedResourceShape(f.document, [], [], expected, describeComplementaryControlShape)
  assert.equal(result.complement.total, 200)
  assert.equal(result.complement.inspected, 128)
  assert.equal(result.complement.controls.length, 16)
  assert.equal(result.complement.truncated, true)
  assert.doesNotMatch(describeComplementaryControlShape.toString(), /textContent|href|\.click\(|scrollTo\(|scrollBy\(/)
})

test('an exact filename in a supplemental control does not widen the capture decision', () => {
  const f = fixture()
  f.link.click = () => { throw new Error('supplement must not activate this link') }
  const source = chatGPTExpectedDownloadScript(expected, 0, false, false, { diagnostics: true })
  const result = new Function('document', `return ${source}`)(f.document)
  assert.equal(result.mode, '')
  assert.equal(result.diagnostic.resources.complement.expected, 1)
})
