import test from 'node:test'
import assert from 'node:assert/strict'
import { electronChildEnvironment, electronLaunchArguments, resolveElectronBinary } from './electron-launch.mjs'

test('Electron child environment cannot inherit run-as-node mode', () => {
  assert.deepEqual(
    electronChildEnvironment({ ELECTRON_RUN_AS_NODE: '1', DISPLAY: ':0' }),
    { DISPLAY: ':0' },
  )
})

test('Linux graphics switches follow the Electron application path', () => {
  assert.deepEqual(electronLaunchArguments('linux', { DISPLAY: ':0' }), {
    ozone: 'x11',
    args: ['.', '--ozone-platform=x11'],
  })
})

test('Wayland launch arguments disable Vulkan', () => {
  assert.deepEqual(electronLaunchArguments('linux', { WHARNESS_OZONE_PLATFORM: 'wayland' }), {
    ozone: 'wayland',
    args: ['.', '--ozone-platform=wayland', '--disable-vulkan', '--disable-features=Vulkan'],
  })
})

test('Linux user-namespace mode disables only the SUID sandbox helper', () => {
  assert.deepEqual(electronLaunchArguments('linux', {
    DISPLAY: ':0',
    WHARNESS_LINUX_SANDBOX_MODE: 'userns',
  }), {
    ozone: 'x11',
    args: ['.', '--disable-setuid-sandbox', '--ozone-platform=x11'],
  })
})


test('Linux lifecycle can pin Electron to an immutable absolute runtime binary', () => {
  assert.equal(
    resolveElectronBinary('/workspace/node_modules/electron/dist/electron', {
      WHARNESS_ELECTRON_BINARY: '/opt/wharness/electron/44.1.1-linux-x64/electron',
    }),
    '/opt/wharness/electron/44.1.1-linux-x64/electron',
  )
})

test('Electron runtime override rejects relative executable paths', () => {
  assert.throws(
    () => resolveElectronBinary('/workspace/node_modules/electron/dist/electron', { WHARNESS_ELECTRON_BINARY: '../electron' }),
    /absolute path/,
  )
})
