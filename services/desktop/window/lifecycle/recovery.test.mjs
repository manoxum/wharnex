import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDesktopWindowRecovery, recoverableDesktopWindows } from './recovery.mjs'

test('window recovery stores only durable projects and consumes the record once', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-window-recovery-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const window = { isDestroyed: () => false }
  const windows = new Map([
    ['first', { id: 'first', window, projects: new Set(['/work/a', '/work/b']), activeProject: '/work/b' }],
    ['surface', { id: 'surface', window, transientSurface: true, projects: new Set(['/work/hidden']) }],
    ['second', { id: 'second', window, projects: new Set(['/work/b', '/work/c']), activeProject: '/work/c' }],
  ])
  const recovery = createDesktopWindowRecovery({
    userDataPath: () => dir, windows,
    canonicalProjectPath: (value) => {
      if (typeof value !== 'string' || !value.startsWith('/work/')) throw new Error('invalid project')
      return value
    },
  })
  assert.equal(recovery.persist(), true)
  const filename = path.join(dir, 'wharness-desktop-recovery-session.json')
  const stored = JSON.parse(await readFile(filename, 'utf8'))
  assert.equal(stored.version, 1)
  assert.deepEqual(stored.windows.map((record) => record.id), ['first', 'second'])
  assert.equal(stored.windows[0].active_project, '/work/b')

  const consumed = recovery.consume()
  assert.deepEqual(consumed, { windows: [
    { id: 'first', projects: ['/work/a', '/work/b'], activeProject: '/work/b' },
    { id: 'second', projects: ['/work/c'], activeProject: '/work/c' },
  ] })
  await assert.rejects(access(filename))
  assert.equal(recovery.consume(), undefined)
})

test('window recovery returns a primary window for an empty or unusable session', () => {
  const fallback = [{ id: 'primary', projects: [], activeProject: '' }]
  assert.deepEqual(recoverableDesktopWindows(undefined), fallback)
  assert.deepEqual(recoverableDesktopWindows({ windows: [{ id: 'stale', projects: [] }] }), fallback)
})
