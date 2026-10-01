import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathSize, restoreBrowserSession, snapshotBrowserSession } from './browser-session-data.mjs'

test('browser session snapshot restores opaque profile files without cache', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wharness-browser-session-test-'))
  const source = path.join(base, 'source')
  const target = path.join(base, 'target')
  await mkdir(path.join(source, 'Network'), { recursive: true })
  await mkdir(path.join(source, 'Cache'), { recursive: true })
  await writeFile(path.join(source, 'Network', 'Cookies'), Buffer.from([0, 1, 2, 3]))
  await writeFile(path.join(source, 'Cache', 'ignored'), 'large cache')
  const snapshot = await snapshotBrowserSession(source)
  const restored = await restoreBrowserSession(target, snapshot)
  assert.equal(restored.files, 1)
  assert.deepEqual(await readFile(path.join(target, 'Network', 'Cookies')), Buffer.from([0, 1, 2, 3]))
  assert.equal(await pathSize(target), 4)
  await assert.rejects(readFile(path.join(target, 'Cache', 'ignored')))
  await rm(base, { recursive: true, force: true })
})

test('browser session import rejects path traversal', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wharness-browser-session-test-'))
  const raw = Buffer.from(JSON.stringify({ format: 'wharness.browser-session/v1', files: [{ path: '../escape', content_base64: 'YQ==' }] }))
  await assert.rejects(restoreBrowserSession(path.join(base, 'target'), raw), /path traversal/)
  await rm(base, { recursive: true, force: true })
})
