import assert from 'node:assert/strict'
import test from 'node:test'
import { chatGPTNavigationDisposition } from '../../../security/security.mjs'
import { createAuthNavigation } from './navigation.mjs'

test('provider redirect starts managed auth at a fresh login without opening the OAuth URL', () => {
  const started = []
  const external = []
  const route = createAuthNavigation({
    chatGPTNavigationDisposition,
    startExternalAuthentication: (_entry, provider) => started.push(provider),
    shell: { openExternal: (url) => external.push(url) },
  })
  const entry = { authMode: 'external' }
  let prevented = 0
  const providerURL = 'https://accounts.google.com/o/oauth2/v2/auth?state=private'
  assert.equal(route(entry, { preventDefault: () => { prevented++ } }, providerURL), true)
  assert.equal(prevented, 1)
  assert.deepEqual(started, ['Google'])
  assert.deepEqual(external, [])
})

test('same-origin auth stays embedded while Google crosses into managed auth', () => {
  const started = []
  const route = createAuthNavigation({
    chatGPTNavigationDisposition,
    startExternalAuthentication: (_entry, provider) => started.push(provider),
    shell: { openExternal: () => assert.fail('provider URL must not be opened') },
  })
  const entry = { authMode: 'embedded' }
  assert.equal(route(entry, {}, 'https://chatgpt.com/auth/login'), false)
  assert.equal(entry.embeddedAuthActive, true)
  let prevented = 0
  assert.equal(route(entry, { preventDefault: () => { prevented++ } }, 'https://accounts.google.com/o/oauth2/v2/auth'), true)
  assert.equal(prevented, 1)
  assert.deepEqual(started, ['Google'])
  assert.equal(entry.embeddedAuthActive, false)
})
