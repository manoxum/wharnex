import test from 'node:test'
import assert from 'node:assert/strict'
import { modelInventoryScript, modelOptionScript } from './scripts.mjs'

function node(label = '', attrs = {}, children = []) {
  return { tagName: 'SPAN', children, textContent: label, id: attrs.id || '',
    getAttribute: (name) => attrs[name] || '', hasAttribute: (name) => name in attrs,
    getBoundingClientRect: () => ({ left: 1, top: 1, width: 20, height: 10 }),
    closest: () => null, querySelectorAll: () => children }
}
function page({ rows = [], expanded = true, triggers = 1 } = {}) {
  const trigger = node('', { 'aria-expanded': expanded ? 'true' : 'false', 'aria-controls': 'owned-menu' })
  const menu = node('', {}, rows)
  const document = { querySelectorAll: (selector) => selector.includes('button') ? Array(triggers).fill(trigger) : [], getElementById: (id) => id === 'owned-menu' ? menu : null }
  const run = (script) => new Function('document', 'getComputedStyle', 'innerWidth', 'innerHeight', `return ${script}`)(document, () => ({ display: 'block', visibility: 'visible' }), 1280, 900)
  return { run, trigger, menu, document }
}

test('inventory reads only model-control labels, never descriptive text or unrelated menu content', () => {
  const rows = [node('Account Alpha Complete marketing description', { 'data-model-id': 'alpha', 'aria-checked': 'true' }, [node('Account Alpha'), node('Complete marketing description')]), node('Account Beta', { 'data-model-id': 'beta', 'aria-disabled': 'true' }, [node('Account Beta')])]
  const result = page({ rows }).run(modelInventoryScript())
  assert.equal(result.ok, true)
  assert.deepEqual(result.options.map(({ id, label, selected, disabled }) => ({ id, label, selected, disabled })), [
    { id: 'alpha', label: 'Account Alpha', selected: true, disabled: false },
    { id: 'beta', label: 'Account Beta', selected: false, disabled: true },
  ])
  assert.doesNotMatch(JSON.stringify(result), /marketing/)
})

test('unlinked or ambiguous controls fail closed and a closed menu only returns its native target', () => {
  assert.equal(page({ triggers: 2 }).run(modelInventoryScript()).state, 'model-control-ambiguous')
  assert.equal(page({ expanded: false }).run(modelInventoryScript()).state, 'model-menu-closed')
  const f = page()
  f.trigger.getAttribute = () => ''
  assert.equal(f.run(modelInventoryScript()).state, 'model-menu-closed')
  f.trigger.getAttribute = (name) => name === 'aria-expanded' ? 'true' : 'wrong-menu'
  assert.equal(f.run(modelInventoryScript()).state, 'model-menu-unavailable')
})

test('selection accepts only bounded row indices and returns a target without synthetic clicks', () => {
  const f = page({ rows: [node('Account Gamma', { 'data-model-id': 'gamma' })] })
  assert.equal(f.run(modelOptionScript(0)).option.id, 'gamma')
  for (const invalid of [-1, 32, '0; fetch(1)', NaN]) assert.throws(() => modelOptionScript(invalid), /Invalid model option index/)
  for (const script of [modelInventoryScript(), modelOptionScript(0)]) {
    assert.doesNotMatch(script, /\.click\(|document\.cookie|localStorage|sessionStorage|innerHTML|fetch\(/)
  }
})


test('an attachment popup cannot substitute for the model control in the composer fallback', () => {
  const f = page({ expanded: false })
  f.document.querySelectorAll = (selector) => selector.includes('data-composer-surface') ? [f.trigger] : []
  f.trigger.getAttribute = (name) => name === 'aria-label' ? 'Add files' : ''
  assert.equal(f.run(modelInventoryScript()).state, 'model-control-unavailable')
})
