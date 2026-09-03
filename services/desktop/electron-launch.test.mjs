import test from 'node:test'
import assert from 'node:assert/strict'
import { electronChildEnvironment, electronLaunchArguments } from './electron-launch.mjs'

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
