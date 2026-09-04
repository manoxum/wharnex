import assert from 'node:assert/strict'
import test from 'node:test'
import { ProjectWindowRegistry, canonicalProjectPath } from './project-window-registry.mjs'

test('project ownership is exclusive across desktop windows but idempotent in the owner', () => {
  const registry = new ProjectWindowRegistry()
  const projectPath = canonicalProjectPath('/tmp/wharness-project-lock')
  assert.deepEqual(registry.acquire('window-a', projectPath), { ok: true, path: projectPath, ownerWindowId: 'window-a' })
  assert.deepEqual(registry.acquire('window-a', projectPath), { ok: true, path: projectPath, ownerWindowId: 'window-a' })
  assert.deepEqual(registry.acquire('window-b', projectPath), { ok: false, path: projectPath, ownerWindowId: 'window-a' })
  assert.equal(registry.release('window-b', projectPath).released, false)
  assert.equal(registry.release('window-a', projectPath).released, true)
  assert.equal(registry.acquire('window-b', projectPath).ok, true)
})

test('closing a window releases all of its project leases only', () => {
  const registry = new ProjectWindowRegistry()
  registry.acquire('window-a', '/tmp/a')
  registry.acquire('window-a', '/tmp/b')
  registry.acquire('window-b', '/tmp/c')
  assert.deepEqual(registry.releaseWindow('window-a').sort(), ['/tmp/a', '/tmp/b'])
  assert.equal(registry.acquire('window-b', '/tmp/a').ok, true)
  assert.equal(registry.acquire('window-a', '/tmp/c').ok, false)
})
