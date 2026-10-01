import test from 'node:test'
import assert from 'node:assert/strict'
import { securePreferences } from './index.mjs'

test('window entry point retains secure browser defaults and additional preload', () => {
  const defaults = securePreferences()
  assert.deepEqual(defaults, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  })
  assert.deepEqual(securePreferences({ preload: '/trusted/preload.cjs' }), {
    ...defaults,
    preload: '/trusted/preload.cjs',
  })
})
