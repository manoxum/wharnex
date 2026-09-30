import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createDesktopCoordinatorRelaunch } from './relaunch.mjs'

test('activation waits for the explicit restarted phase and stops after rollback', async () => {
  const statuses = ['phase=building', 'phase=restarted']
  const relaunch = createDesktopCoordinatorRelaunch({
    root: () => '/work', isQuitting: () => false, attempts: 3,
    readStatus: async (file, encoding) => {
      assert.equal(file, '/work/.harness/self-evolution/status')
      assert.equal(encoding, 'utf8')
      return statuses.shift()
    },
    wait: async () => {},
  })
  assert.equal(await relaunch.waitForSelfEvolutionActivation(), true)
  statuses.push('phase=rolled_back_runtime')
  assert.equal(await relaunch.waitForSelfEvolutionActivation(), false)
})

test('relaunch uses the detached helper and waits until its process starts', async () => {
  const calls = []
  const child = new EventEmitter()
  child.unref = () => calls.push('unref')
  const relaunch = createDesktopCoordinatorRelaunch({
    root: () => '/work', isQuitting: () => false, parentPID: () => 42,
    spawnHelper: (helper, argv, options) => {
      calls.push({ helper, argv, cwd: options.cwd, detached: options.detached, stdio: options.stdio, root: options.env.WHARNESS_ROOT })
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
  })
  await relaunch.scheduleDesktopCoordinatorRelaunch()
  assert.deepEqual(calls, [
    { helper: '/work/scripts/desktop-relaunch.sh', argv: ['/work', '42'], cwd: '/work', detached: true, stdio: 'ignore', root: '/work' },
    'unref',
  ])
})
