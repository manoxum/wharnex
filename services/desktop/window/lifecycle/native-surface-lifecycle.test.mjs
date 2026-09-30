import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { installNativeSurfaceLifecycleGuard, shouldSuspendNativeSurfacesForNavigation } from './native-surface-lifecycle.mjs'

const FRONTEND_ORIGIN = 'http://127.0.0.1:5173'

test('same-origin main-frame document replacement suspends native surfaces', () => {
  assert.equal(shouldSuspendNativeSurfacesForNavigation(`${FRONTEND_ORIGIN}/?wharnessWindow=one`, { frontendOrigin: FRONTEND_ORIGIN, isSameDocument: false, isMainFrame: true }), true)
  assert.equal(shouldSuspendNativeSurfacesForNavigation(`${FRONTEND_ORIGIN}/#section`, { frontendOrigin: FRONTEND_ORIGIN, isSameDocument: true, isMainFrame: true }), false)
  assert.equal(shouldSuspendNativeSurfacesForNavigation(`${FRONTEND_ORIGIN}/frame`, { frontendOrigin: FRONTEND_ORIGIN, isSameDocument: false, isMainFrame: false }), false)
  assert.equal(shouldSuspendNativeSurfacesForNavigation('https://example.com', { frontendOrigin: FRONTEND_ORIGIN, isSameDocument: false, isMainFrame: true }), false)
})

test('Electron navigation details and renderer loss share the suspension boundary', () => {
  const webContents = new EventEmitter()
  const reasons = []
  const cleanup = installNativeSurfaceLifecycleGuard(webContents, { frontendOrigin: FRONTEND_ORIGIN, suspend: (reason) => reasons.push(reason) })
  webContents.emit('did-start-navigation', { url: `${FRONTEND_ORIGIN}/`, isSameDocument: false, isMainFrame: true })
  webContents.emit('did-start-navigation', { url: 'https://example.com', isSameDocument: false, isMainFrame: true })
  webContents.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.deepEqual(reasons, ['renderer-navigation', 'renderer-gone'])
  cleanup()
  webContents.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.deepEqual(reasons, ['renderer-navigation', 'renderer-gone'])
})

test('Desktop wires the guard to the complete native-surface suspension helper', () => {
  const source = readFileSync(new URL('../../main.mjs', import.meta.url), 'utf8')
  const createWindow = readFileSync(new URL('./create/window.mjs', import.meta.url), 'utf8')
  assert.match(source, /createDesktopWindowCreator\(\{[\s\S]*installNativeSurfaceLifecycleGuard, suspendNativeSurfacesForWindow/)
  assert.match(createWindow, /installNativeSurfaceLifecycleGuard\(win\.webContents, \{ frontendOrigin: FRONTEND_ORIGIN, suspend: \(\) => suspendNativeSurfacesForWindow\(state\) \}\)/)
})
