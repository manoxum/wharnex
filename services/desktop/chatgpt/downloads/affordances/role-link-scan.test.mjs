import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTExpectedDownloadScript } from './index.mjs'

const expected = 'whx_bundle_res_owned_req_current.zip'
function link(id, options = {}) {
  const attrs = { role: 'link', 'aria-label': options.filename ?? expected, ...options.attrs }
  const node = { tagName: 'SPAN', owned: options.owned !== false, disabled: options.disabled === true, offsetWidth: options.hidden ? 0 : 20, offsetHeight: options.hidden ? 0 : 10, getClientRects: () => options.hidden ? [] : [{}], hasAttribute: (name) => Object.hasOwn(attrs, name), contains: () => false, click: () => { node.clicked += 1 }, clicked: 0, located: 0, getBoundingClientRect: () => { node.located += 1; return { left: 20, top: 30, width: 20, height: 10 } } }
  node.getAttribute = (name) => { if (name === 'href') throw new Error('role-link href must not be read'); return attrs[name] || null }
  node.closest = (selector) => options.block && selector.includes(options.block) ? { matches: () => true } : null
  for (const field of ['textContent', 'href']) Object.defineProperty(node, field, { get() { throw new Error(`role-link ${field} must not be read`) } })
  return { id, node }
}
function run(controls, { assistant = false, main = true, exactOnly = false, freshOnly = false } = {}) {
  const nodes = controls.map(({ node }) => node)
  const surface = { contains: (node) => node.owned === true }
  const turn = { contains: (node) => nodes.includes(node), closest: () => null }
  const document = {
    defaultView: { innerWidth: 800, innerHeight: 600 },
    elementFromPoint: () => nodes.findLast((node) => node.located > 0),
    querySelector: () => main ? surface : null,
    querySelectorAll: (selector) => selector === '[data-message-author-role="assistant"]' ? assistant ? [turn] : []
      : selector.startsWith('a[download]') && selector.includes('[role="link"]') ? nodes : [],
  }
  const result = new Function('document', `return ${chatGPTExpectedDownloadScript(expected, 0, freshOnly, exactOnly, { diagnostics: true })}`)(document)
  assert.equal(nodes.reduce((sum, node) => sum + node.clicked, 0), 0)
  if (result.mode) { assert.equal(result.nativeTarget.kind, 'exact-role-link'); assert.deepEqual(result.nativeTarget.rect, { x: 30, y: 35 }) }
  return result.mode
}

test('the measured exact response filename on a role-link is located for native capture without answer text or href', () => {
  const control = link('expected')
  assert.equal(run([control], { exactOnly: true }), 'exact')
  assert.ok(control.node.located > 0)
})

test('duplicate exact role-link controls prefer the most recent visible enabled owned control', () => {
  const first = link('first')
  const latest = link('latest')
  const hidden = link('hidden', { hidden: true })
  const disabled = link('disabled', { disabled: true })
  const ariaDisabled = link('aria-disabled', { attrs: { 'aria-disabled': 'true' } })
  const inert = link('inert', { block: '[inert]' })
  assert.equal(run([first, latest, hidden, disabled, ariaDisabled, inert]), 'exact')
  assert.equal(first.node.located, 0)
  assert.ok(latest.node.located > 0)
  assert.equal(hidden.node.clicked + disabled.node.clicked + ariaDisabled.node.clicked + inert.node.clicked, 0)
})

test('wrong requests and generic role-links cannot join latest-assistant fallback', () => {
  const wrong = link('wrong', { filename: 'whx_bundle_res_owned_req_older.zip' })
  const generic = link('generic', { filename: 'Transferir', attrs: { 'data-file-name': 'result.zip' } })
  const longer = link('longer', { filename: `${expected}.extra.zip` })
  const otherExtension = link('other-extension', { filename: `${expected}.pdf` })
  assert.equal(run([wrong, generic, longer, otherExtension], { assistant: true }), '')
  assert.equal(wrong.node.clicked + generic.node.clicked + longer.node.clicked + otherExtension.node.clicked, 0)
})

test('exact role-links in user/composer/sidebar or outside the owned main cannot be captured', () => {
  const controls = [link('user', { block: '[data-message-author-role="user"]' }), link('composer', { block: '[data-composer-surface]' }), link('sidebar', { block: 'aside' }), link('outside', { owned: false })]
  assert.equal(run(controls), '')
  assert.equal(controls.reduce((sum, { node }) => sum + node.clicked, 0), 0)
  assert.equal(run([link('missing-main')], { main: false }), '')
})

test('the role-link branch bounds inspected controls and attribute values', () => {
  const controls = Array.from({ length: 128 }, (_, index) => link(String(index), { filename: 'Transferir' }))
  controls.push(link('over-cap'))
  assert.equal(run(controls), '')
  assert.equal(controls[128].node.clicked, 0)
  assert.equal(run([link('over-attribute-cap', { filename: `x`.repeat(512) + expected })]), '')
})

test('role-link exact matching preserves the existing fresh-assistant requirement', () => {
  const control = link('fresh')
  assert.equal(run([control], { freshOnly: true }), '')
  assert.equal(run([control], { assistant: true, freshOnly: true }), 'exact')
  assert.ok(control.node.located > 0)
})

test('unowned role-links cannot exhaust the owned-control budget and each allowed attribute can match', () => {
  const outside = Array.from({ length: 150 }, (_, index) => link(`outside-${index}`, { owned: false }))
  for (const field of ['download', 'aria-label', 'title', 'data-file-name']) {
    const control = link(field, { filename: 'Transferir', attrs: { [field]: expected } })
    assert.equal(run([...outside, control]), 'exact')
    assert.ok(control.node.located > 0)
  }
})
