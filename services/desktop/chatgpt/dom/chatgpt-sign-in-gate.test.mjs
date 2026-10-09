import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTHumanActionScript } from './chatgpt-dom.mjs'

// A minimal structural document: each selector list maps to the nodes it finds.
function page({ path = '/', signIn = false, composer = true } = {}) {
  const node = { isConnected: true, getBoundingClientRect: () => ({ width: 10, height: 10 }), getAttribute: () => null, closest: () => null }
  const document = {
    title: 'ChatGPT', visibilityState: 'visible',
    querySelectorAll: (selector) => {
      if (selector.includes('login-button')) return signIn ? [node] : []
      if (selector === '#prompt-textarea') return composer ? [node] : []
      return []
    },
  }
  return new Function('document', 'location', `return ${chatGPTHumanActionScript()}`)(document, { pathname: path, href: `https://chatgpt.com${path}` })
}

test('a visible sign-in control is an authentication gate even with a composer on screen', () => {
  const health = page({ signIn: true, composer: true })
  assert.equal(health.required, true)
  assert.equal(health.kind, 'authentication')
  assert.equal(health.composerReady, true)
})

test('an authenticated page with a composer needs no human action', () => {
  assert.deepEqual([page().required, page().kind], [false, ''])
})

test('the /auth route remains an authentication gate', () => {
  assert.equal(page({ path: '/auth/login', composer: false }).kind, 'authentication')
})
