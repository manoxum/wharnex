import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTAssistantTurnCountScript, chatGPTResponseCompletionScript } from '../chatgpt-dom.mjs'

function page({ generating = false, latestUser = false } = {}) {
  const composer = { getAttribute: () => '', closest: () => null }
  const marker = { compareDocumentPosition: () => latestUser ? 4 : 2 }
  const user = {}
  return {
    querySelector: (selector) => selector.includes('stop-button') && generating ? {} : null,
    querySelectorAll: (selector) => {
      if (selector === '[data-chatgpt-agent-turn-start]') return [marker]
      if (selector === '[class~="group/user-message"]') return [user]
      if (selector.includes('prompt-textarea')) return [composer]
      return []
    },
  }
}

const inspect = (document, baseline = 0) => new Function('document', `return ${chatGPTResponseCompletionScript(baseline)}`)(document)

test('the current provider turn marker detects completion without reading response prose', () => {
  const document = page()
  const state = inspect(document)
  assert.equal(state.assistantCount, 1)
  assert.equal(state.lastRole, 'assistant')
  assert.equal(state.complete, true)
  assert.equal(new Function('document', `return ${chatGPTAssistantTurnCountScript()}`)(document), 1)
  assert.doesNotMatch(chatGPTResponseCompletionScript(), /textContent|innerText|innerHTML|outerHTML/)
})

test('a stop control, unchanged baseline or latest user turn cannot complete a request', () => {
  assert.equal(inspect(page({ generating: true })).complete, false)
  assert.equal(inspect(page(), 1).complete, false)
  const state = inspect(page({ latestUser: true }))
  assert.equal(state.lastRole, 'user')
  assert.equal(state.complete, false)
})
