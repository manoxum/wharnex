import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createBrowserSessionOperations } from './session-operations.mjs'

test('pending session import restores the validated archive and deletes its staging file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharnex-browser-'))
  const pending = path.join(root, 'pending.whbs')
  const archive = Buffer.from('browser archive')
  await writeFile(pending, archive)
  let restored
  const operations = createBrowserSessionOperations({
    pendingImportPath: () => pending,
    partitionPath: () => path.join(root, 'partition'),
    restore: async (target, bytes) => { restored = { target, bytes } },
  })
  try {
    assert.equal(await operations.applyPendingImport(), true)
    assert.equal(restored.target, path.join(root, 'partition'))
    assert.deepEqual(restored.bytes, archive)
    await assert.rejects(readFile(pending), { code: 'ENOENT' })
    assert.equal(await operations.applyPendingImport(), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('clear session drops pending requests and private browser state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharnex-browser-'))
  const profile = path.join(root, 'auth-profile')
  const cleared = []
  const chatSession = {
    clearStorageData: async () => { cleared.push('storage') },
    clearCache: async () => { cleared.push('cache') },
    flushStorageData: async () => { cleared.push('flush') },
  }
  const drafts = new Map([['one', {}]])
  const prompts = new Map([['one', {}]])
  const bundles = new Map([['one', {}]])
  let recentCleared = false
  const operations = createBrowserSessionOperations({
    session: { fromPartition: () => chatSession }, partition: 'persist:chatgpt',
    authProfilePath: () => profile, closeViews: () => cleared.push('views'),
    closeInternalBrowsers: () => cleared.push('browsers'),
    closeManagedAuth: async () => { cleared.push('auth') },
    authBrowsers: new Map([['one', {}]]), preparedDrafts: drafts,
    retryablePrompts: prompts, expectedBundles: bundles,
    clearRecentDownload: () => { recentCleared = true },
  })
  try {
    assert.deepEqual(await operations.clearSession(), { ok: true })
    assert.deepEqual(cleared, ['views', 'browsers', 'auth', 'storage', 'cache', 'flush'])
    assert.equal(drafts.size + prompts.size + bundles.size, 0)
    assert.equal(recentCleared, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
