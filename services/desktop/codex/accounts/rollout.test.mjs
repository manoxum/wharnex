import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { transferOwnedRollout } from './rollout.mjs'

test('account handoff copies only the exact owned rollout and rejects credential paths and symlinks', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-rollout-')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source'), target = path.join(root, 'target'), sessions = path.join(source, 'sessions')
  await mkdir(sessions, { recursive: true }); const filename = path.join(sessions, 'rollout-thread-owned.jsonl')
  await writeFile(filename, 'owned native history')
  const record = { threadId: 'thread-owned', rolloutPath: filename }
  const copied = await transferOwnedRollout(record, source, target)
  assert.equal(await readFile(copied, 'utf8'), 'owned native history'); assert.equal((await stat(copied)).mode & 0o777, 0o600)
  await writeFile(path.join(source, 'auth.json'), 'private auth')
  await assert.rejects(transferOwnedRollout({ ...record, rolloutPath: path.join(source, 'auth.json') }, source, target), /fora/)
  const linked = path.join(sessions, 'linked-thread-owned.jsonl'); await symlink(filename, linked)
  await assert.rejects(transferOwnedRollout({ ...record, rolloutPath: linked }, source, target), /inválido/)
  await assert.rejects(transferOwnedRollout({ ...record, threadId: 'other' }, source, target), /fora/)
})
