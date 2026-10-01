import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDesktopRestartIntent } from './restart-intent.mjs'

test('restart intent survives one process handoff and is consumed once', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-restart-intent-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const intent = createDesktopRestartIntent({ userDataPath: () => dir })
  intent.persist('current', 'primary')
  const stored = JSON.parse(await readFile(path.join(dir, 'wharness-window-restart-intent.json'), 'utf8'))
  assert.equal(stored.version, 1)
  assert.deepEqual(intent.consume(), { scope: 'current', currentWindowId: 'primary' })
  assert.equal(intent.consume(), undefined)
})

test('restart intent refuses stale and malformed records', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-restart-intent-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filename = path.join(dir, 'wharness-window-restart-intent.json')
  const intent = createDesktopRestartIntent({ userDataPath: () => dir })
  await writeFile(filename, JSON.stringify({ scope: 'current', current_window_id: 'primary', created_at: Date.now() - 11 * 60 * 1000 }))
  assert.equal(intent.consume(), undefined)
  await writeFile(filename, JSON.stringify({ scope: 'all', current_window_id: '../other', created_at: Date.now() }))
  assert.equal(intent.consume(), undefined)
})
