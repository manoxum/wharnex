import test from 'node:test'
import assert from 'node:assert/strict'
import { chromeCompatibleUserAgent, resolveLinuxOzonePlatform } from './security.mjs'

test('Linux ozone selection prefers X11 when XWayland is available', () => {
  assert.equal(resolveLinuxOzonePlatform({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), 'x11')
  assert.equal(resolveLinuxOzonePlatform({ WHARNESS_OZONE_PLATFORM: 'wayland', DISPLAY: ':0' }), 'wayland')
  assert.equal(resolveLinuxOzonePlatform({ WAYLAND_DISPLAY: 'wayland-0' }), 'wayland')
})

test('ChatGPT compatibility user agent exposes Chrome without Electron token', () => {
  const ua = chromeCompatibleUserAgent('linux', '152.0.7977.65')
  assert.match(ua, /Chrome\/152\.0\.7977\.65/)
  assert.doesNotMatch(ua, /Electron/i)
})
