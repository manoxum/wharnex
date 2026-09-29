import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeOrchestratorResultFilename, orchestratorRequestBootstrap, orchestratorRequestFilename, writeOrchestratorRequestBundle } from './chat-agent-orchestrator-request.mjs'
import { writeChatInputZip } from './chat-input-zip-writer.mjs'

const requestId = 'orp_20260927T120000_0123456789abcdef'

function storedZipEntries(bytes) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8)
    const length = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extraLength
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString()
    entries.set(name, { method, bytes: bytes.subarray(start, start + length) })
    offset = start + length
  }
  return entries
}

test('orchestrator Worker sends one bounded request ZIP with metadata, prompt and inputs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-orchestrator-test-'))
  try {
    const target = path.join(dir, orchestratorRequestFilename(requestId))
    const result = await writeOrchestratorRequestBundle(target, {
      requestId, prompt: 'Plan a local example', createdAt: '2026-09-27T12:00:00Z',
      attachments: [{ name: 'fixture.txt', bytes: Buffer.from('fixture contents') }],
      contextBytes: Buffer.from('PK\x03\x04example'),
    })
    assert.equal(result.requestFilename, path.basename(target))
    assert.match(result.bootstrap, /Read the single attached ZIP/)
    assert.doesNotMatch(result.bootstrap, /Plan a local example|fixture contents/)
    const entries = storedZipEntries(await readFile(target))
    assert.deepEqual([...entries.keys()], [
      'transport.json', 'prompt/wharnex-orchestrator-prompt.md',
      'context/project.zip', 'attachments/001-fixture.txt',
    ])
    const transport = JSON.parse(entries.get('transport.json').bytes.toString())
    assert.equal(transport.request_id, requestId)
    assert.equal(transport.request_metadata.protocol, 'harness.request-metadata/v1')
    assert.equal(transport.result_filename, 'whx_bundle_res_orchestrator_' + requestId + '.zip')
    assert.equal(entries.get('attachments/001-fixture.txt').bytes.toString(), 'fixture contents')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Partial orchestrator planning sends maps first and only selected bodies later', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-orchestrator-partial-'))
  try {
    const snapshot = path.join(dir, 'snapshot.zip')
    await writeChatInputZip(snapshot, [
      { name: 'main.txt', bytes: Buffer.from('main body') },
      { name: 'other.txt', bytes: Buffer.from('other body') },
    ])
    const captured = { bytes: await readFile(snapshot), maps: [{ path: 'context-map/main/maps', content: '{"files":["main.txt","other.txt"]}' }], mode: 'partial', paths: [] }
    const target = path.join(dir, orchestratorRequestFilename(requestId))
    await writeOrchestratorRequestBundle(target, { requestId, prompt: 'Plan', context: captured })
    let entries = storedZipEntries(await readFile(target))
    assert.ok(entries.has('context-map/main/maps'))
    assert.ok(!entries.has('context/main.txt') && !entries.has('context/other.txt'))
    await rm(target)
    await writeOrchestratorRequestBundle(target, { requestId, prompt: 'Plan', context: { ...captured, paths: ['context/main.txt'] } })
    entries = storedZipEntries(await readFile(target))
    assert.equal(entries.get('context/main.txt').bytes.toString(), 'main body')
    assert.ok(!entries.has('context/other.txt'))
    const transport = JSON.parse(entries.get('transport.json').bytes.toString())
    assert.deepEqual(transport.context_paths, ['context/main.txt'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('orchestrator request rejects unsafe attachment names and mismatched output identity', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-orchestrator-test-'))
  try {
    const target = path.join(dir, orchestratorRequestFilename(requestId))
    await assert.rejects(writeOrchestratorRequestBundle(target, {
      requestId, prompt: 'Plan', attachments: [{ name: '../secret', bytes: Buffer.from('x') }],
    }), /attachment name is invalid/)
    assert.throws(() => orchestratorRequestBootstrap(requestId, 'other.zip'), /result filename/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('orchestrator result capture tolerates only Chromium duplicate ZIP suffixes', () => {
  const name = 'whx_bundle_res_orchestrator_' + requestId + '.zip'
  assert.equal(normalizeOrchestratorResultFilename(name), name)
  assert.equal(normalizeOrchestratorResultFilename(name.replace('.zip', ' (2).zip')), name)
  assert.notEqual(normalizeOrchestratorResultFilename(name.replace('.zip', ' (0).zip')), name)
})
