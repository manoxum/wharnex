import test from 'node:test'
import assert from 'node:assert/strict'
import { reasoningEffortStateScript } from '../chat-agent-reasoning-effort-scripts.mjs'
import { baseBehavior } from '../chat-agent-behavior.mjs'

function control(text, { label = '', children = [] } = {}) {
  return { textContent: text, children, childNodes: [{ nodeType: 3, textContent: text }, ...children], getAttribute: (name) => name === 'aria-label' ? label : '',
    getBoundingClientRect: () => ({ width: 10, height: 10 }), closest: () => null }
}

function observe(levels) {
  const title = control('Esforço de raciocínio')
  const version = control('5.6')
  const selected = levels.map((level) => control(level, { children: [control('')] }))
  const button = control('Esforço de raciocínio5.6 ' + levels.join(' '), {
    label: 'Selecionar modelo do ChatGPT', children: [title, version, ...selected],
  })
  button.querySelectorAll = () => [title, version, ...selected]
  const surface = { contains: (node) => node === button }
  const composer = { ...control(''), closest: (selector) => selector.includes('composer') ? surface : null }
  const document = { querySelectorAll: (selector) => selector.includes('button') ? [button]
    : selector.includes('prompt-textarea') ? [composer] : [] }
  return new Function('document', `return ${reasoningEffortStateScript(baseBehavior('chatgpt'))}`)(document)
}

test('a selected effort containing an icon remains readable inside the owned control', () => {
  const state = observe(['Elevada'])
  assert.equal(state.ok, true)
  assert.equal(state.effort, 'high')
})

test('the model version and reasoning title cannot stand in for a verified effort', () => {
  assert.equal(observe([]).state, 'effort-level-unknown')
  assert.equal(observe(['Elevada', 'Médio']).state, 'effort-level-unknown')
})
