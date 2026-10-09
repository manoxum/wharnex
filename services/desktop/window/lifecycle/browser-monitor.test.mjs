import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserMonitorOpener } from './browser-monitor.mjs'
import { readFileSync } from 'node:fs'
import { readDesktopCompositionSourceSync } from '../../composition/entry/source.mjs'

test('browser monitor has one independent window and restores it from the tray', () => {
  const calls = []
  const windows = new Map()
  const createWindow = (id, persist, launch) => {
    calls.push([id, persist, launch])
    const state = { window: { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') } }
    windows.set(id, state)
    return state
  }
  const open = createBrowserMonitorOpener(windows, createWindow)
  const first = open()
  assert.deepEqual(calls[0], ['browser-monitor', false, { browserMonitor: true }])
  assert.equal(open(), first)
  assert.deepEqual(calls.slice(1), ['restore', 'show', 'focus'])
})

test('tray launch reaches the composed Desktop window creator', () => {
  const main = readDesktopCompositionSourceSync()
  const entry = readFileSync(new URL('../../composition/entry/runtime.mjs', import.meta.url), 'utf8')
  assert.match(main, /return \(\.\.\.args\) => ctx\.desktopEntrypoint\.createWindow\(\.\.\.args\)[\s\S]*createWindow: createWindowLater\(ctx\)/)
  assert.match(entry, /createWindow: window\.createWindow/)
})
