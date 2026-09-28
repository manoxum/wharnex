import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTConversationLoadFailureScript, detectChatGPTConversationLoadFailure } from './chatgpt-conversation-load.mjs'

function node({ visible = true, disabled = false, inside = [] } = {}) {
  return {
    disabled,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: visible ? 80 : 0, height: visible ? 24 : 0 }),
    closest: (selector) => inside.some((tag) => selector.split(',').map((part) => part.trim()).includes(tag)) ? {} : null,
    clicked: 0,
    click() { this.clicked += 1 },
  }
}

function page({ path = '/c/6ab9c881-0da0-83ea-a7f5-635202bbebc5', ready = 'complete', turns = 0, composer = false, buttons = [] } = {}) {
  const main = { querySelectorAll: (selector) => selector === 'button' ? buttons : [] }
  const document = {
    readyState: ready,
    querySelector: (selector) => selector === 'main' ? main : null,
    querySelectorAll: (selector) => {
      if (selector.includes('data-message-author-role')) return Array.from({ length: turns }, () => node())
      if (composer && selector.includes('prompt-textarea')) return [node()]
      return []
    },
  }
  return { document, location: { pathname: path } }
}

test('the "could not load this conversation" surface is found structurally with its single retry control', () => {
  const retry = node()
  const { document, location } = page({ buttons: [retry, node({ inside: ['header'] }), node({ visible: false })] })
  const result = detectChatGPTConversationLoadFailure(document, location)
  assert.equal(result.failed, true)
  assert.equal(result.retry, retry)
})

test('without exactly one retry control the failure is still reported, for a reload instead', () => {
  const { document, location } = page({ buttons: [node(), node()] })
  const result = detectChatGPTConversationLoadFailure(document, location)
  assert.equal(result.failed, true)
  assert.equal(result.retry, null)
})

test('a healthy, loading, or non-conversation page is never treated as a load failure', () => {
  assert.equal(detectChatGPTConversationLoadFailure(page({ turns: 2, buttons: [node()] }).document, page().location).failed, false)
  assert.equal(detectChatGPTConversationLoadFailure(page({ composer: true, buttons: [node()] }).document, page().location).failed, false)
  assert.equal(detectChatGPTConversationLoadFailure(page({ ready: 'interactive', buttons: [node()] }).document, page().location).failed, false)
  const home = page({ path: '/', buttons: [node()] })
  assert.equal(detectChatGPTConversationLoadFailure(home.document, home.location).failed, false)
})

test('the injected script reads no page text and clicks only when asked', () => {
  const retry = node()
  const { document, location } = page({ buttons: [retry] })
  const run = (click) => new Function('document', 'location', `return ${chatGPTConversationLoadFailureScript(click)}`)(document, location)
  assert.deepEqual(run(false), { failed: true, loaded: false, retryable: true, clicked: false })
  assert.equal(retry.clicked, 0)
  assert.deepEqual(run(true), { failed: true, loaded: false, retryable: true, clicked: true })
  assert.equal(retry.clicked, 1)
  assert.doesNotMatch(chatGPTConversationLoadFailureScript(true), /textContent|innerText|innerHTML|aria-label|document\.cookie|localStorage|fetch\(/)
})

test('only a rendered thread or composer counts as a loaded conversation', () => {
  assert.equal(detectChatGPTConversationLoadFailure(page({ turns: 1 }).document, page().location).loaded, true)
  assert.equal(detectChatGPTConversationLoadFailure(page({ composer: true }).document, page().location).loaded, true)
  assert.equal(detectChatGPTConversationLoadFailure(page({ ready: 'interactive' }).document, page().location).loaded, false)
  const home = page({ path: '/', turns: 1 })
  assert.equal(detectChatGPTConversationLoadFailure(home.document, home.location).loaded, false)
})
