import test from 'node:test'
import assert from 'node:assert/strict'
import { modelInventoryScript } from './scripts.mjs'
import { normalizeModelPopupDiagnostic } from './popup-diagnostic.mjs'

test('a linked effort panel reports bounded structural submenu metadata without treating effort as model options', () => {
  const element = (tagName, attrs = {}) => ({ tagName, children: [], getAttribute: (key) => attrs[key] || '', hasAttribute: (key) => key in attrs, closest: () => null, getBoundingClientRect: () => ({ left: 4, top: 8, width: 80, height: 24 }), get textContent() { throw new Error('control text is outside this diagnosis') } })
  const trigger = element('BUTTON', { 'aria-expanded': 'true', 'aria-controls': 'effort-panel', 'aria-haspopup': 'dialog' })
  const slider = element('DIV', { role: 'slider', 'aria-valuetext': 'High' })
  const submenu = element('BUTTON', { 'aria-haspopup': 'menu', 'aria-controls': 'models-submenu', 'aria-expanded': 'false' })
  const menu = element('DIV', { role: 'dialog' })
  menu.querySelectorAll = (selector) => selector === '[role="menuitemradio"],[role="option"],[data-model-id]' ? [] : [slider, submenu]
  const catalog = element('DIV', { role: 'menu', hidden: '' })
  const document = { querySelectorAll: (selector) => selector.includes('button') ? [trigger] : [], getElementById: (id) => ({ 'effort-panel': menu, 'models-submenu': catalog })[id] }
  const raw = new Function('document', 'getComputedStyle', 'innerWidth', 'innerHeight', `return ${modelInventoryScript()}`)(document, () => ({ display: 'block', visibility: 'visible' }), 800, 600)
  assert.equal(raw.state, 'model-options-unavailable')
  assert.equal(raw.diagnostic.sliderCount, 1)
  assert.equal(raw.diagnostic.submenuCount, 1)
  assert.equal(raw.diagnostic.optionCount, 0)
  assert.equal(raw.diagnostic.menu.role, 'dialog')
  assert.equal(raw.diagnostic.controls[1].linkedRole, 'menu')
  assert.equal(raw.diagnostic.controls[1].hasPopup, 'menu')
  assert.doesNotMatch(JSON.stringify(raw), /High|aria-valuetext/)
})

test('popup diagnostics re-bound geometry and discard text, IDs and arbitrary attributes before logging', () => {
  const control = { tag: 'BUTTON', role: 'button', hasPopup: 'menu', bounds: { left: 9e9, top: NaN, width: 30, height: 12 }, label: 'private prose', ariaControls: 'untrusted-id', href: 'https://example.invalid' }
  const result = normalizeModelPopupDiagnostic({ sliderCount: 999, controls: Array(100).fill(control), prose: 'answer' })
  assert.equal(result.sliderCount, 64)
  assert.equal(result.controls.length, 16)
  assert.equal(result.controls[0].bounds.left, 1_000_000)
  assert.equal(result.controls[0].bounds.top, null)
  assert.doesNotMatch(JSON.stringify(result), /private prose|untrusted-id|https:|answer/)
})
