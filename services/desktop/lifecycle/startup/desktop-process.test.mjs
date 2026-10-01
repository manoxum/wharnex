import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { configureDesktopProcess } from './index.mjs'

function fixture({ platform = 'linux', userData = '', lock = true } = {}) {
  const events = []
  const app = new EventEmitter()
  const processTarget = new EventEmitter()
  const BrowserWindow = { getAllWindows: () => [] }
  app.commandLine = { appendSwitch: (name) => events.push(`switch:${name}`) }
  app.disableHardwareAcceleration = () => events.push('software-gpu')
  app.setPath = (name, value) => events.push(`path:${name}:${value}`)
  app.requestSingleInstanceLock = () => { events.push('lock'); return lock }
  app.quit = () => events.push('quit')
  const logger = { error: (...args) => events.push(['error', ...args]) }
  const options = {
    app, BrowserWindow, environment: { WHARNESS_DESKTOP_USER_DATA_DIR: userData },
    platform, processTarget, logger, getMainWindow: () => undefined,
  }
  return { options, events }
}

test('configures Chromium and fault handlers before claiming the profile', () => {
  const { options, events } = fixture({ userData: '/tmp/wharnex-profile' })
  configureDesktopProcess(options)
  assert.deepEqual(events, [
    'switch:disable-ipv6', 'software-gpu', 'path:userData:/tmp/wharnex-profile', 'lock',
  ])
  const fault = new Error('renderer fault')
  options.processTarget.emit('uncaughtException', fault)
  options.processTarget.emit('unhandledRejection', fault)
  assert.deepEqual(events.slice(4), [
    ['error', '[main-process-fault] uncaughtException', fault],
    ['error', '[main-process-fault] unhandledRejection', fault],
  ])
})

test('second instance restores a window while rejected locks quit', () => {
  const { options, events } = fixture({ platform: 'darwin' })
  const windowEvents = []
  const window = {
    isMinimized: () => true,
    restore: () => windowEvents.push('restore'),
    show: () => windowEvents.push('show'),
    focus: () => windowEvents.push('focus'),
  }
  options.getMainWindow = () => window
  configureDesktopProcess(options)
  assert.deepEqual(events, ['switch:disable-ipv6', 'lock'])
  options.app.emit('second-instance')
  assert.deepEqual(windowEvents, ['restore', 'show', 'focus'])

  const denied = fixture({ lock: false })
  configureDesktopProcess(denied.options)
  assert.deepEqual(denied.events.slice(-2), ['lock', 'quit'])
  assert.equal(denied.options.app.listenerCount('second-instance'), 0)
})

test('rejects a relative profile directory before requesting the lock', () => {
  const { options, events } = fixture({ userData: 'relative/profile' })
  assert.throws(() => configureDesktopProcess(options), /must be an absolute path/)
  assert.deepEqual(events, ['switch:disable-ipv6', 'software-gpu'])
})
