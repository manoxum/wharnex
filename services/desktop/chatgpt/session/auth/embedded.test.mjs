import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmbeddedChatGPTAuthentication } from './embedded.mjs'

test('embedded authentication only publishes a probe from the same trusted page', async () => {
  const published = []
  let url = 'https://chatgpt.com/c/one'
  const entry = {
    authenticated: false, externalAuthProvider: '',
    view: { webContents: {
      isDestroyed: () => false, getURL: () => url,
      executeJavaScript: async () => { url = 'https://chatgpt.com/auth/login'; return true },
    } },
  }
  const embedded = createEmbeddedChatGPTAuthentication({
    isTrustedChatGPTOrigin: (value) => value.startsWith('https://chatgpt.com/'),
    isChatGPTAuthURL: (value) => value.includes('/auth/'),
    chatGPTSessionProbeExpression: () => 'probe',
    publishChatGPTState: (key) => published.push(key),
    chatGPTNavigationDisposition: () => ({ kind: 'trusted' }),
    publishAuthComplete: () => {}, sanitizeDiagnosticURL: (value) => value,
  })
  await embedded.refreshEmbeddedChatGPTAuthentication('chat', entry)
  assert.equal(entry.authenticated, false)
  assert.deepEqual(published, [])
  entry.authenticated = true
  await embedded.refreshEmbeddedChatGPTAuthentication('chat', entry)
  assert.equal(entry.authenticated, false)
  assert.deepEqual(published, ['chat'])
})

test('embedded callback requires the owned login flow to return to the ChatGPT home', () => {
  const completed = []
  const entry = { embeddedAuthActive: true, embeddedAuthCrossedBoundary: false }
  const embedded = createEmbeddedChatGPTAuthentication({
    isTrustedChatGPTOrigin: () => true, isChatGPTAuthURL: () => false,
    chatGPTSessionProbeExpression: () => '', publishChatGPTState: () => {},
    chatGPTNavigationDisposition: (url) => ({ kind: url.includes('provider') ? 'external-auth' : 'trusted' }),
    publishAuthComplete: (...args) => completed.push(args), sanitizeDiagnosticURL: (value) => value,
  })
  embedded.observeEmbeddedAuthURL('chat', entry, 'https://chatgpt.com/c/one')
  assert.equal(completed.length, 0)
  embedded.observeEmbeddedAuthURL('chat', entry, 'https://chatgpt.com/')
  assert.deepEqual(completed[0], ['chat', 'embedded', 'https://chatgpt.com/'])
  assert.equal(entry.embeddedAuthActive, false)
})
