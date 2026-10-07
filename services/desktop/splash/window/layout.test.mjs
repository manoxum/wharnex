import test from 'node:test'
import assert from 'node:assert/strict'
import { COLLAPSED_HEIGHT, EXPANDED_HEIGHT, SPLASH_WIDTH, resizeSplashWindow } from './layout.mjs'

test('expanding and collapsing changes the locked native size without moving the dragged window', () => {
  const state = { width: SPLASH_WIDTH, height: COLLAPSED_HEIGHT, x: 120, y: 80, resizable: false, changes: 0 }
  const window = {
    isDestroyed: () => false, getSize: () => [state.width, state.height],
    setResizable(value) { state.resizable = value },
    setSize(width, height) { if (!state.resizable) return; Object.assign(state, { width, height }); state.changes++ },
  }
  resizeSplashWindow(window, false)
  assert.equal(state.height, EXPANDED_HEIGHT)
  assert.equal(state.resizable, false)
  resizeSplashWindow(window, true)
  assert.equal(state.height, COLLAPSED_HEIGHT)
  assert.deepEqual([state.x, state.y], [120, 80])
  assert.equal(state.resizable, false)
  resizeSplashWindow(window, true)
  resizeSplashWindow(window, 'untrusted')
  assert.equal(state.changes, 2)
})

test('does not resize a closed splash', () => {
  resizeSplashWindow({ isDestroyed: () => true, getSize() { assert.fail('closed windows have no usable geometry') } }, false)
})
