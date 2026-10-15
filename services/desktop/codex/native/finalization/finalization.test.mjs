import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { captureNativeBaseline, finalizeNativeChanges } from './index.mjs'
import { createNativeEvents } from '../events.mjs'

const execute = promisify(execFile)
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-finalization-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = async (...args) => (await execute('git', ['-C', root, ...args])).stdout.trim()
  await git('init', '-q'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com')
  await writeFile(path.join(root, 'VERSION'), 'v1.2.3.4\n')
  await writeFile(path.join(root, 'source.txt'), 'before\n')
  await writeFile(path.join(root, 'human.txt'), 'human\n')
  await git('add', '.'); await git('commit', '-qm', 'initial')
  const record = { projectPath: root, requestId: 'req_test', title: 'Fix', threadId: 'thread', turnId: 'turn', status: 'running', messages: [],
    activities: [{ id: 'patch', type: 'fileChange', changes: [{ path: 'source.txt' }] }], gitBaseline: await captureNativeBaseline(root) }
  return { root, git, record, write: (name, text) => writeFile(path.join(root, name), text) }
}
test('native completion persists final diffs, commit and canonical patch version, preserving unrelated staged work', async (t) => {
  const { root, git, record, write } = await fixture(t)
  await write('source.txt', 'after\n'); await write('new.txt', 'new\n')
  record.activities[0].changes.push({ path: 'new.txt' })
  await write('human.txt', 'human staged\n'); await git('add', 'human.txt')
  const ledger = []
  const journal = { sanitize: (value) => value, append: async (_record, method, params) => ledger.push({ method, params }), settle: async () => {} }
  const events = createNativeEvents({ find: () => record, save: async () => {}, publish() {}, journal, interactions: { retire() {} } })
  await events('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } })
  assert.equal(await readFile(path.join(root, 'VERSION'), 'utf8'), 'v1.2.3.5\n')
  assert.match(await git('log', '-1', '--format=%s'), /v1\.2\.3\.5/)
  assert.equal(await git('diff', '--cached', '--name-only'), 'human.txt')
  assert.match(record.activities.at(-1).changes[0].diff, /\+after/)
  assert.match(record.messages.at(-1).text, /commit [a-f0-9]{40}/)
  assert.equal(ledger.at(-1).method, 'native/finalized')
  const head = await git('rev-parse', 'HEAD')
  await events('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } })
  assert.equal(await git('rev-parse', 'HEAD'), head)
})
test('advice and failed turns do not bump or commit', async (t) => {
  const { root, git, record, write } = await fixture(t)
  const head = await git('rev-parse', 'HEAD')
  assert.equal((await finalizeNativeChanges(record)).changes.length, 0)
  await write('source.txt', 'unfinished\n')
  const events = createNativeEvents({ find: () => record, save: async () => {}, publish() {},
    journal: { append: async () => {}, settle: async () => {} }, interactions: { retire() {} } })
  await events('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'failed' } })
  assert.equal(await git('rev-parse', 'HEAD'), head)
  assert.equal(await readFile(path.join(root, 'VERSION'), 'utf8'), 'v1.2.3.4\n')
})
test('pre-existing edits and changed HEAD fail closed', async (t) => {
  const { git, record, write, root } = await fixture(t)
  await write('source.txt', 'human\n'); record.gitBaseline = await captureNativeBaseline(root)
  await write('source.txt', 'human plus native\n')
  assert.equal((await finalizeNativeChanges(record)).status, 'failed')
  await git('add', 'source.txt'); await git('commit', '-qm', 'human')
  await write('source.txt', 'native\n'); record.gitBaseline.dirty = []
  assert.equal((await finalizeNativeChanges(record)).status, 'failed')
  assert.equal(await readFile(path.join(root, 'VERSION'), 'utf8'), 'v1.2.3.4\n')
})
test('symlinks, secrets and paths outside the root are never staged', async (t) => {
  const { root, git, record, write } = await fixture(t)
  await write('.env', 'SECRET=value\n'); await symlink('human.txt', path.join(root, 'link.txt'))
  record.activities[0].changes = [{ path: '.env' }, { path: 'link.txt' }, { path: '../outside' }]
  const head = await git('rev-parse', 'HEAD')
  assert.equal((await finalizeNativeChanges(record)).changes.length, 0)
  assert.equal(await git('rev-parse', 'HEAD'), head)
})
test('manual commit mode exposes the diff and bumped version without creating a commit', async (t) => {
  const { git, record, write, root } = await fixture(t)
  const head = await git('rev-parse', 'HEAD')
  await write('source.txt', 'manual\n')
  const result = await finalizeNativeChanges({ ...record, gitCommitMode: 'manual' })
  assert.match(result.explanation, /commit manual pendente/)
  assert.equal(result.changes.length, 2)
  assert.equal(await git('rev-parse', 'HEAD'), head)
  assert.equal(await readFile(path.join(root, 'VERSION'), 'utf8'), 'v1.2.3.5\n')
})
test('commit failure preserves diffs, restores VERSION and leaves no staged metadata', async (t) => {
  const { git, record, write, root } = await fixture(t)
  const head = await git('rev-parse', 'HEAD')
  await write('source.txt', 'after\n')
  await writeFile(path.join(root, '.git/index.lock'), 'owned by another writer')
  const result = await finalizeNativeChanges(record)
  assert.equal(result.status, 'failed')
  assert.match(result.changes[0].diff, /\+after/)
  assert.equal(await git('rev-parse', 'HEAD'), head)
  assert.equal(await git('diff', '--cached', '--name-only'), '')
  assert.equal(await readFile(path.join(root, 'VERSION'), 'utf8'), 'v1.2.3.4\n')
})
test('automatic bookkeeping never executes project Git hooks', async (t) => {
  const { record, write, root } = await fixture(t)
  await write('source.txt', 'after\n')
  await writeFile(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  assert.equal((await finalizeNativeChanges(record)).status, 'completed')
})
test('a continued request can finalize its original changed paths after live activities were cleared', async (t) => {
  const { record, write, git } = await fixture(t)
  await write('source.txt', 'continued\n')
  record.nativeChangedPaths = ['source.txt']; record.activities = []
  const result = await finalizeNativeChanges(record)
  assert.equal(result.status, 'completed')
  assert.match(result.changes[0].diff, /\+continued/)
  assert.match(await git('show', 'HEAD:source.txt'), /continued/)
})
test('the engine creates a missing VERSION with the initial canonical patch version', async (t) => {
  const { record, write, git, root } = await fixture(t)
  await git('rm', 'VERSION'); await git('commit', '-qm', 'no version')
  record.gitBaseline = await captureNativeBaseline(root)
  await write('source.txt', 'after\n')
  assert.equal((await finalizeNativeChanges(record)).status, 'completed')
  assert.equal(await git('show', 'HEAD:VERSION'), 'v0.0.0.1')
})
test('overlapping turns and model-written VERSION require manual review', async (t) => {
  const { git, record, write } = await fixture(t)
  const head = await git('rev-parse', 'HEAD')
  await write('source.txt', 'after\n')
  assert.equal((await finalizeNativeChanges({ ...record, gitBaseline: { ...record.gitBaseline, concurrent: true } })).status, 'failed')
  await write('VERSION', 'v9.0.0.0\n')
  assert.equal((await finalizeNativeChanges(record)).status, 'failed')
  assert.equal(await git('rev-parse', 'HEAD'), head)
})
