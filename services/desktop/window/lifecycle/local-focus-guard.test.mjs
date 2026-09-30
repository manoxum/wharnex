import test from 'node:test'
import assert from 'node:assert/strict'
import { preserveLocalFocusDuringBackgroundOperation } from './local-focus-guard.mjs'

function virtualTimers() {
  const pending = []
  let sequence = 0
  return {
    schedule(callback, delay) {
      pending.push({ callback, delay: Number(delay) || 0, sequence: sequence += 1 })
    },
    run() {
      pending.sort((left, right) => left.delay - right.delay || left.sequence - right.sequence)
      while (pending.length) pending.shift().callback()
    },
  }
}

test('background native activity restores the local composer after delayed child-view focus transfer', () => {
  const timers = virtualTimers()
  const owner = { isDestroyed: () => false }
  let focusedWindow = owner
  let activeSurface = 'local-composer'
  let localFocusCalls = 0
  const composer = {
    isDestroyed: () => false,
    focus: () => { activeSurface = 'local-composer'; localFocusCalls += 1 },
  }

  preserveLocalFocusDuringBackgroundOperation(() => {
    // This mimics Electron applying the focus transfer after the synchronous
    // visible -> resize -> hidden view operation has already returned.
    timers.schedule(() => { activeSurface = 'remote-child-view' }, 20)
  }, {
    captureLocal: () => composer,
    ownerFor: () => owner,
    isOwnerFocused: (candidate) => candidate === focusedWindow,
    schedule: timers.schedule,
  })
  timers.run()

  assert.equal(activeSurface, 'local-composer')
  assert.ok(localFocusCalls >= 3, 'the guard must outlive a late compositor focus transfer')
})

test('background focus recovery never pulls focus back from another native window', () => {
  const timers = virtualTimers()
  const owner = { isDestroyed: () => false }
  const otherWindow = { isDestroyed: () => false }
  let focusedWindow = owner
  let localFocusCalls = 0
  const composer = {
    isDestroyed: () => false,
    focus: () => { localFocusCalls += 1 },
  }

  preserveLocalFocusDuringBackgroundOperation(() => {
    timers.schedule(() => { focusedWindow = otherWindow }, 1)
  }, {
    captureLocal: () => composer,
    ownerFor: () => owner,
    isOwnerFocused: (candidate) => candidate === focusedWindow,
    schedule: timers.schedule,
  })
  timers.run()

  assert.equal(localFocusCalls, 2, 'only the synchronous and zero-delay recoveries may run before the user changes windows')
})
