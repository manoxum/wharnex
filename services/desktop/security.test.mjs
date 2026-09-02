import test from 'node:test'
import assert from 'node:assert/strict'
import { chromeCompatibleUserAgent, contextBundleURL, externalAuthProvider, isTrustedChatGPTOrigin, normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, resolveLinuxOzonePlatform, sanitizeDiagnosticURL, sanitizeSessionId } from './security.mjs'

test('session ids are strictly allowlisted', () => {
  assert.equal(sanitizeSessionId('ses_20260902_abc-123'), 'ses_20260902_abc-123')
  assert.throws(() => sanitizeSessionId('../etc/passwd'))
})

test('frontend/backend URLs must remain local HTTP', () => {
  assert.equal(requireLocalHTTPURL('http://127.0.0.1:8080').port, '8080')
  assert.throws(() => requireLocalHTTPURL('https://evil.example'))
  assert.throws(() => requireLocalHTTPURL('file:///tmp/x'))
})

test('context bundle URL is generated internally', () => {
  assert.equal(contextBundleURL('http://127.0.0.1:8080', 'ses_abc'), 'http://127.0.0.1:8080/api/sessions/ses_abc/bundle')
})

test('native view bounds are clamped to window content', () => {
  assert.deepEqual(normalizeBounds({ x: -5, y: 12, width: 900, height: 900 }, { width: 500, height: 400 }), { x: 0, y: 12, width: 500, height: 388 })
  assert.deepEqual(normalizeBounds({ x: 999, y: 999, width: 20, height: 20 }, { width: 500, height: 400 }), { x: 499, y: 399, width: 1, height: 1 })
})

test('Linux ozone selection prefers X11 when XWayland is available', () => {
  assert.equal(resolveLinuxOzonePlatform({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), 'x11')
  assert.equal(resolveLinuxOzonePlatform({ WHARNESS_OZONE_PLATFORM: 'wayland', DISPLAY: ':0' }), 'wayland')
  assert.equal(resolveLinuxOzonePlatform({ WAYLAND_DISPLAY: 'wayland-0' }), 'wayland')
})


test('external OAuth providers are identified for system-browser routing', () => {
  assert.equal(externalAuthProvider('https://accounts.google.com/o/oauth2/v2/auth'), 'Google')
  assert.equal(externalAuthProvider('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'), 'Microsoft')
  assert.equal(externalAuthProvider('https://appleid.apple.com/auth/authorize'), 'Apple')
  assert.equal(externalAuthProvider('https://chatgpt.com/'), '')
  assert.equal(externalAuthProvider('javascript:alert(1)'), '')
})


test('ChatGPT compatibility user agent exposes Chrome without Electron token', () => {
  const ua = chromeCompatibleUserAgent('linux', '152.0.7977.65')
  assert.match(ua, /Chrome\/152\.0\.7977\.65/)
  assert.doesNotMatch(ua, /Electron/i)
})

test('diagnostic URLs omit query strings and fragments', () => {
  assert.equal(
    sanitizeDiagnosticURL('https://chatgpt.com/backend-api/conversation?token=secret#frag'),
    'https://chatgpt.com/backend-api/conversation',
  )
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
