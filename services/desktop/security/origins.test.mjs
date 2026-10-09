import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTNavigationDisposition, contextBundleURL, externalAuthProvider, isChatGPTAuthURL, isTrustedChatGPTOrigin, requireLocalHTTPURL, requireTrustedChatGPTURL, sanitizeChatGPTAuthMode } from './security.mjs'

test('frontend/backend URLs must remain local HTTP', () => {
  assert.equal(requireLocalHTTPURL('http://127.0.0.1:8080').port, '8080')
  assert.throws(() => requireLocalHTTPURL('https://evil.example'))
  assert.throws(() => requireLocalHTTPURL('file:///tmp/x'))
})

test('context bundle URL is generated internally', () => {
  assert.equal(contextBundleURL('http://127.0.0.1:8080', 'ses_abc'), 'http://127.0.0.1:8080/api/sessions/ses_abc/bundle')
})

test('external OAuth providers are identified for system-browser routing', () => {
  assert.equal(externalAuthProvider('https://auth.openai.com/log-in'), 'OpenAI')
  assert.equal(externalAuthProvider('https://auth0.openai.com/authorize'), 'OpenAI')
  assert.equal(externalAuthProvider('https://accounts.google.com/o/oauth2/v2/auth'), 'Google')
  assert.equal(externalAuthProvider('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'), 'Microsoft')
  assert.equal(externalAuthProvider('https://appleid.apple.com/auth/authorize'), 'Apple')
  assert.equal(externalAuthProvider('https://chatgpt.com/'), '')
  assert.equal(externalAuthProvider('javascript:alert(1)'), '')
})

test('ChatGPT navigation distinguishes ChatGPT auth, provider auth and ordinary links', () => {
  assert.deepEqual(chatGPTNavigationDisposition('https://chatgpt.com/auth/login'), { kind: 'chatgpt-auth', provider: 'OpenAI' })
  assert.deepEqual(chatGPTNavigationDisposition('https://auth.openai.com/log-in'), { kind: 'external-auth', provider: 'OpenAI' })
  assert.deepEqual(chatGPTNavigationDisposition('https://accounts.google.com/o/oauth2/v2/auth'), { kind: 'external-auth', provider: 'Google' })
  assert.deepEqual(chatGPTNavigationDisposition('https://example.com/docs'), { kind: 'external', provider: '' })
  assert.deepEqual(chatGPTNavigationDisposition('javascript:alert(1)'), { kind: 'deny', provider: '' })
})

test('ChatGPT authentication mode is strict and auth paths are recognized', () => {
  assert.equal(sanitizeChatGPTAuthMode('embedded'), 'embedded')
  assert.equal(sanitizeChatGPTAuthMode('external'), 'external')
  assert.throws(() => sanitizeChatGPTAuthMode('system'))
  assert.equal(isChatGPTAuthURL('https://chatgpt.com/auth/login'), true)
  assert.equal(isChatGPTAuthURL('https://chatgpt.com/auth/callback/openai'), true)
  assert.equal(isChatGPTAuthURL('https://chatgpt.com/c/abc'), false)
})

test('clipboard permission origin is restricted to ChatGPT HTTPS', () => {
  assert.equal(isTrustedChatGPTOrigin('https://chatgpt.com/c/abc'), true)
  assert.equal(isTrustedChatGPTOrigin('https://foo.chatgpt.com/path'), true)
  assert.equal(isTrustedChatGPTOrigin('http://chatgpt.com/'), false)
  assert.equal(isTrustedChatGPTOrigin('https://chatgpt.com.evil.example/'), false)
  assert.equal(isTrustedChatGPTOrigin('https://openai.com/'), false)
  assert.equal(isTrustedChatGPTOrigin('javascript:alert(1)'), false)
})

test('ChatGPT navigation URLs are restricted to the trusted remote surface', () => {
  assert.equal(requireTrustedChatGPTURL('https://chatgpt.com/c/abc'), 'https://chatgpt.com/c/abc')
  assert.throws(() => requireTrustedChatGPTURL('https://chatgpt.com.evil.example/c/abc'))
  assert.throws(() => requireTrustedChatGPTURL('http://chatgpt.com/c/abc'))
  assert.throws(() => requireTrustedChatGPTURL('https://user:secret@chatgpt.com/c/abc'))
})
