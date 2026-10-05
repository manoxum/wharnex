import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { chatInputArchiveFilename, chatInputPartManifest, localChatInputBootstrap, writeChatInputTransportArchives } from './index.mjs'
import { storedEntries } from '../chat-input-zip-test-helper.mjs'

test('one-part transport reuses the completed logical ZIP without a second copy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wharnex-direct-input-'))
  try {
    const result = await writeChatInputTransportArchives(dir, {
      chatId: 'chat-direct', requestId: 'req_20260925T220000_direct',
      maxTotalBytes: 8 * 1024 * 1024, maxPartBytes: 8 * 1024 * 1024, maxParts: 2,
      prompt: '# Direct request', knowledge: { state: 'none' },
    })
    assert.equal(result.parts.length, 1)
    assert.deepEqual(await readdir(dir), [result.archiveName])
    assert.match(storedEntries(await readFile(result.archivePath)).get('prompt/wharness-planner-prompt.md').toString(), /# Direct request/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('configured multipart transport reconstructs the exact logical request ZIP', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-multipart-input-'))
  try {
    const requestId = 'req_20260922T160947_multipart'
    const payload = Buffer.alloc((1536 * 1024), 0x61)
    const result = await writeChatInputTransportArchives(root, {
      chatId: 'chat-multipart', requestId, maxTotalBytes: 4 * 1024 * 1024, maxPartBytes: 1024 * 1024, maxParts: 3,
      prompt: '# Planner\n\nUse the multipart request.',
      knowledge: { state: 'none', protocol: 'harness.knowledge/v2', sharing_enabled: true, revision: 1, sha256: '', entries: [] },
      attachments: [{ name: 'large.txt', bytes: payload }],
    })
    assert.equal(result.parts.length, 2)
    assert.equal(result.parts[0].name, chatInputArchiveFilename('chat-multipart', requestId))
    assert.match(result.parts[1].name, /_part-02-of-02\.zip$/)
    const chunks = []
    let transport
    for (const part of result.parts) {
      assert.ok(part.bytes <= 1024 * 1024)
      const entries = storedEntries(await readFile(part.path))
      transport = transport || JSON.parse(entries.get('transport.json').toString('utf8'))
      assert.equal(JSON.parse(entries.get('transport.json').toString('utf8')).protocol, 'wharness.chat-input-part/v1')
      chunks.push(entries.get('multipart/payload.part'))
    }
    const reconstructed = Buffer.concat(chunks)
    assert.equal(reconstructed.byteLength, result.logicalBytes)
    const crypto = await import('node:crypto')
    assert.equal(crypto.createHash('sha256').update(reconstructed).digest('hex'), transport.payload_sha256)
    const logicalEntries = storedEntries(reconstructed)
    assert.equal(logicalEntries.get('attachments/large.txt').byteLength, payload.byteLength)
    const bootstrap = localChatInputBootstrap(requestId, result.archiveName, `whx_bundle_res_chat-multipart_${requestId}.zip`, result.requestMetadata, result.multipart)
    assert.match(bootstrap, /transported in 2 attached ZIP parts/)
    assert.match(bootstrap, /concatenate the raw bytes from multipart\/payload\.part/)
    assert.match(bootstrap, new RegExp(transport.payload_sha256))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('configured request total and part-count limits fail before upload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-multipart-limit-'))
  try {
    const base = {
      chatId: 'chat-limit', requestId: 'req_20260922T160947_limitcase', prompt: '# Planner',
      knowledge: { state: 'none' }, attachments: [{ name: 'large.bin', bytes: Buffer.alloc(2200 * 1024, 1) }],
    }
    await assert.rejects(writeChatInputTransportArchives(root, { ...base, maxTotalBytes: 1024 * 1024, maxPartBytes: 1024 * 1024, maxParts: 3 }), /above the configured total limit/)
    await assert.rejects(writeChatInputTransportArchives(root, { ...base, requestId: 'req_20260922T160947_partlimit', maxTotalBytes: 4 * 1024 * 1024, maxPartBytes: 1024 * 1024, maxParts: 2 }), /above the configured maximum/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a persisted part exposes only its stored part manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharnex-part-manifest-'))
  try {
    const requestId = 'req_20260922T160947_partmanifest'
    const result = await writeChatInputTransportArchives(root, {
      chatId: 'chat-part', requestId, maxTotalBytes: 4 * 1024 * 1024, maxPartBytes: 1024 * 1024, maxParts: 3,
      prompt: '# Planner', knowledge: { state: 'none' }, attachments: [{ name: 'large.bin', bytes: Buffer.alloc(1536 * 1024, 7) }],
    })
    const manifest = chatInputPartManifest(await readFile(result.parts[1].path))
    assert.equal(manifest.part_index, 2)
    assert.equal(manifest.payload_name, chatInputArchiveFilename('chat-part', requestId))
    assert.equal(chatInputPartManifest(Buffer.from('not a zip at all, but long enough')), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
