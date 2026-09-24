import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTVisibleActivityScript } from './chatgpt-visible-activity.mjs'

class FakeNode {
  constructor(tag, text = '', kind = '', children = []) {
    this.tagName = tag.toUpperCase()
    this.textContent = text
    this.kind = kind
    this.children = children
    for (const child of children) child.parentElement = this
  }

  get nextElementSibling() {
    const siblings = this.parentElement?.children || []
    return siblings[siblings.indexOf(this) + 1] || null
  }

  get firstElementChild() { return this.children[0] || null }
  getClientRects() { return [1] }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  querySelectorAll(selector) {
    return this.descendants().filter((node) => matches(node, selector))
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.split(',').some((part) => matches(node, part.trim()))) return node
    }
    return null
  }
}

function matches(node, selector) {
  if (selector === 'span, div, p, li') return ['SPAN', 'DIV', 'P', 'LI'].includes(node.tagName)
  if (selector.includes('group/activity-header') || selector.includes('data-testid*="reasoning"')) return node.kind === 'activity'
  if (selector === '[data-chatgpt-agent-turn-start]') return node.kind === 'turn-marker'
  if (selector === '[data-turn-id]') return node.kind === 'legacy-turn'
  if (selector === '[data-markdown-text-style]') return node.kind === 'activity-row'
  if (selector === 'button' || selector === '[role="button"]') return node.tagName === 'BUTTON' || node.kind === 'button'
  if (['pre', 'code', '.markdown', '.sr-only', '[data-message-author-role]', '[data-markdown-copy]'].includes(selector)) return node.kind === selector
  return false
}

function activityHeader(value) {
  return new FakeNode('div', value, 'activity', [new FakeNode('span', value)])
}

function activityRow(value) {
  return new FakeNode('div', value, 'activity-row', [new FakeNode('p', value)])
}

function animatedActivityRow(parts) {
  const value = parts.join('')
  const fragments = parts.map((part) => new FakeNode('span', part))
  return new FakeNode('div', value, 'activity-row', [new FakeNode('p', value, '', fragments)])
}

function nestedActivityDocument() {
  const nested = new FakeNode('div', 'Nested operation', '', [activityHeader('Nested operation')])
  const body = new FakeNode('div', '', '', [activityRow('First detail'), nested, activityRow('Second detail')])
  const expanded = new FakeNode('div', '', '', [activityHeader('Preparing delivery'), body])
  const tool = new FakeNode('code', 'Excluded tool output', 'code')
  const final = new FakeNode('div', '', '', [activityHeader('Analysed result'), tool])
  const turn = new FakeNode('div', '', '', [new FakeNode('span', '', 'turn-marker'), expanded, final])
  return {
    querySelector: () => null,
    querySelectorAll: (selector) => [turn, ...turn.descendants()].filter((node) => matches(node, selector)),
  }
}

test('visible reasoning capture stays inside its bounded exception', () => {
  const source = chatGPTVisibleActivityScript()
  for (const selector of ['pre', 'code', '.markdown', '.sr-only', '[data-message-author-role]']) {
    assert.ok(source.includes(selector), `missing structural exclusion ${selector}`)
  }
  assert.match(source, /rows\.length >= 8/)
  assert.match(source, /value\.length < 8 \|\| value\.length > 200/)
  assert.doesNotMatch(source, /\.click\(\)/)
  assert.match(source, /catch \{ \/\* reasoning is optional; liveness is not \*\/ \}/)
})

test('visible reasoning includes nested activity rows but excludes tool output', () => {
  const result = new Function('document', `return ${chatGPTVisibleActivityScript()}`)(nestedActivityDocument())
  const rows = result.text.split('\n')
  assert.equal(rows.length, 5)
  assert.ok(rows.some((row) => row.includes('Nested operation')))
  assert.ok(rows.every((row) => !row.includes('Excluded tool output')))
})

test('visible reasoning keeps an animated sub-reasoning line intact', () => {
  const header = activityHeader('Analisar modal de operações Git')
  const body = new FakeNode('div', '', '', [
    activityRow('Definiu o âmbito'),
    animatedActivityRow(['Ajustou ', 'a ', 'implementação']),
  ])
  const turn = new FakeNode('div', '', '', [new FakeNode('span', '', 'turn-marker'), new FakeNode('div', '', '', [header, body])])
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => [turn, ...turn.descendants()].filter((node) => matches(node, selector)),
  }

  const result = new Function('document', `return ${chatGPTVisibleActivityScript()}`)(document)
  assert.equal(result.text, '- Analisar modal de operações Git\n- Definiu o âmbito\n- Ajustou a implementação')
})
