import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeProjectVersion, readProjectVersion } from './splash-version.mjs'

test('splash resolves the engine-owned project VERSION', () => {
  assert.match(readProjectVersion(), /^v\d+\.\d+\.\d+\.\d+$/)
})

test('splash accepts only canonical four-part project versions', () => {
  assert.equal(normalizeProjectVersion('  v1.2.56.4\n'), 'v1.2.56.4')
  assert.equal(normalizeProjectVersion('1.2.56.4'), '')
  assert.equal(normalizeProjectVersion('v1.2.56'), '')
})

test('splash omits unavailable or invalid project versions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-version-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const versionFile = path.join(root, 'VERSION')
  await writeFile(versionFile, 'development\n')
  assert.equal(readProjectVersion(versionFile), '')
  assert.equal(readProjectVersion(path.join(root, 'missing')), '')
})
