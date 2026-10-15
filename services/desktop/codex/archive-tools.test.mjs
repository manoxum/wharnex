import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createArchiveTools } from './archive-tools.mjs'
import { writeChatInputZip } from '../transport/chat-input-zip-writer.mjs'
import { readBoundedArchive } from '../transport/archive/reader.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-codex-tools-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const inputPath = path.join(root, 'input.zip')
  await writeChatInputZip(inputPath, [{ name: 'transport.json', bytes: Buffer.from('{}') }, { name: 'context/test.ts', bytes: Buffer.from('const safe = true') }])
  let created
  const call = createArchiveTools({ inputPath, outputRoot: root, expectedFilename: 'response.zip', onCreated: async (value) => { created = value } })
  return { call, root, created: () => created }
}
test('archive tools can inspect only the request snapshot and page its text', async (t) => {
  const { call } = await fixture(t)
  const result = await call('wharnex_archive_read', { path: 'context/test.ts', limit: 5 })
  assert.deepEqual(JSON.parse(result.contentItems[0].text), { path: 'context/test.ts', content: 'const', nextOffset: 5 })
  await assert.rejects(call('wharnex_archive_read', { path: '/etc/passwd' }))
  await assert.rejects(call('wharnex_archive_read', { path: '../auth.json' }))
  await assert.rejects(call('wharnex_archive_read', { path: 'auth.json' }))
  await assert.rejects(call('command/exec', { command: ['touch', 'host'] }))
})
test('archive creation returns one exact ZIP and never applies its contents', async (t) => {
  const fixtureValue = await fixture(t)
  await fixtureValue.call('wharnex_archive_create', { entries: [{ path: 'turn.json', content: '{"kind":"ask"}' }] })
  assert.equal(fixtureValue.created(), path.join(fixtureValue.root, 'response.zip'))
  const entries = readBoundedArchive(await readFile(fixtureValue.created()))
  assert.equal(entries[0].name, 'turn.json')
  assert.equal(entries[0].bytes.toString(), '{"kind":"ask"}')
  await assert.rejects(fixtureValue.call('wharnex_archive_create', { entries: [{ path: 'another', content: '' }] }))
})
test('response paths, duplicates and oversized entries fail closed', async (t) => {
  const { call } = await fixture(t)
  for (const name of ['/tmp/escape', '../escape', 'a/../../escape', 'C:/escape', 'a\\escape']) {
    await assert.rejects(call('wharnex_archive_create', { entries: [{ path: name, content: '' }] }))
  }
  await assert.rejects(call('wharnex_archive_create', { entries: [{ path: 'a', content: '' }, { path: 'A', content: '' }] }))
  await assert.rejects(call('wharnex_archive_create', { entries: [{ path: 'a', content: 'x'.repeat((8 << 20) + 1) }] }))
})

test('response manifests can hash exact UTF-8 bytes without command execution', async () => {
  const call = createArchiveTools({ inputPath: '/unread', outputRoot: '/unwritten', expectedFilename: 'unused.zip', onCreated() {} })
  const result = await call('wharnex_archive_digest', { content: 'abc' })
  assert.deepEqual(JSON.parse(result.contentItems[0].text), { sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', bytes: 3 })
  await assert.rejects(call('wharnex_archive_digest', { content: 'a'.repeat((8 << 20) + 1) }))
})
