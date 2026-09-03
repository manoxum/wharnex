import test from 'node:test'
import assert from 'node:assert/strict'
import { electronCookieDetails, isChatGPTCookie, managedBrowserProfileDirectory, resolveManagedBrowserExecutable } from './managed-browser-auth.mjs'


test('managed auth profile is persistent below Wharness userData rather than a temporary directory', () => {
  assert.equal(managedBrowserProfileDirectory('/home/demo/.config/Wharness'), '/home/demo/.config/Wharness/ManagedBrowser/AuthProfile')
  assert.throws(() => managedBrowserProfileDirectory('/'), /userData inválido/)
})

test('managed auth browser resolves an explicitly configured real browser first', () => {
  const env = { WHARNESS_BROWSER_EXECUTABLE: '/opt/google/chrome', PATH: '/bin:/usr/bin' }
  assert.equal(resolveManagedBrowserExecutable('linux', env, (candidate) => candidate === '/opt/google/chrome'), '/opt/google/chrome')
})

test('managed auth cookie relay accepts ChatGPT cookies but rejects unrelated and anti-bot cookies', () => {
  assert.equal(isChatGPTCookie({ domain: '.chatgpt.com', name: '__Secure-authjs.session-token', value: 'secret' }), true)
  assert.equal(isChatGPTCookie({ domain: 'chatgpt.com', name: 'oai-session', value: 'secret' }), true)
  assert.equal(isChatGPTCookie({ domain: '.chatgpt.com', name: 'cf_clearance', value: 'opaque' }), false)
  assert.equal(isChatGPTCookie({ domain: '.google.com', name: 'SID', value: 'secret' }), false)
})

test('managed auth cookie relay maps cookie metadata without exposing unrelated browser cookies', () => {
  assert.deepEqual(electronCookieDetails({
    domain: '.chatgpt.com', name: '__Secure-authjs.session-token', value: 'opaque', path: '/',
    secure: true, httpOnly: true, sameSite: 'Lax', expires: 1900000000,
  }), {
    url: 'https://chatgpt.com/', name: '__Secure-authjs.session-token', value: 'opaque', path: '/',
    secure: true, httpOnly: true, domain: '.chatgpt.com', expirationDate: 1900000000, sameSite: 'lax',
  })
  assert.equal(electronCookieDetails({ domain: '.openai.com', name: 'session', value: 'x' }), undefined)
})
