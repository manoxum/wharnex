import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { chatInputArchiveFilename, commentAttachmentArchiveFilename, localChatInputBootstrap, writeChatInputArchive, writeCommentAttachmentArchive } from './chat-input-archive.mjs'

function storedEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8)
    const size = buffer.readUInt32LE(offset + 18)
    const nameBytes = buffer.readUInt16LE(offset + 26)
    const extraBytes = buffer.readUInt16LE(offset + 28)
    assert.equal(method, 0)
    const nameStart = offset + 30
    const dataStart = nameStart + nameBytes + extraBytes
    const name = buffer.subarray(nameStart, nameStart + nameBytes).toString('utf8')
    entries.set(name, buffer.subarray(dataStart, dataStart + size))
    offset = dataStart + size
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50)
  assert.equal(buffer.readUInt32LE(buffer.byteLength - 22), 0x06054b50)
  return entries
}

test('direct ChatGPT input is one ZIP with prompt, context, artifacts and user files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-input-'))
  try {
    const requestId = 'req_20260905T083123_example123'
    const filename = chatInputArchiveFilename('chat-1', requestId)
    const target = path.join(root, filename)
    const knowledgeContent = '# Project knowledge\n\n- Prior integration lesson.\n'
    const knowledgeSha256 = 'a9d213eb8d86ef6c392563787faead1dcfae23d588dbb6bf01070a4d1b0476c1'
    const result = await writeChatInputArchive(target, {
      requestId,
      prompt: `# Planner\n\nPROJECT KNOWLEDGE\nKnowledge identity: version=3 sha256=${knowledgeSha256}\n${knowledgeContent}\nReturn the bundle.`,
      knowledge: { state: 'present', content: knowledgeContent, version: 3, sha256: knowledgeSha256, updated_by_request_id: 'req_earlier12345678' },
      context: { bytes: Buffer.from('UEsDBBQAAAAIAFpiJl1Dv6ajBAAAAAIAAAANAAAAbWFuaWZlc3QuanNvbquuBQBQSwMEFAAAAAgAWmImXU5FPCsVAAAAEwAAAAsAAABzcmMvQXBwLnRzeEutKMgvKlFIzs8rLlGoULBVMOQCAFBLAQIUAxQAAAAIAFpiJl1Dv6ajBAAAAAIAAAANAAAAAAAAAAAAAACAAQAAAABtYW5pZmVzdC5qc29uUEsBAhQDFAAAAAgAWmImXU5FPCsVAAAAEwAAAAsAAAAAAAAAAAAAAIABLwAAAHNyYy9BcHAudHN4UEsFBgAAAAACAAIAdAAAAG0AAAAAAA==', 'base64') },
      artifacts: [{ name: 'result.md', bytes: Buffer.from('result') }],
      attachments: [{ name: 'notes.txt', bytes: Buffer.from('notes') }],
      projectFiles: ['src/App.tsx'],
      liveTunnels: [
        { provider: 'primary', instance_id: 'tunnel-1', status: 'https://primary.example/status', manifest: 'https://primary.example/secret/manifest.json' },
        { provider: 'fallback', instance_id: 'tunnel-2', status: 'https://fallback.example/status', manifest: 'https://fallback.example/secret/manifest.json' },
      ],
    })
    const raw = await readFile(target)
    const entries = storedEntries(raw)
    assert.equal(raw.byteLength, result.bytes)
    assert.equal(result.fileCount, 8)
    assert.deepEqual([...entries.keys()], [
      'transport.json',
      'prompt/wharness-planner-prompt.md',
      'knowledge/project.md',
      'context/manifest.json',
      'context/src/App.tsx',
      'references/project-files.json',
      'artifacts/result.md',
      'attachments/notes.txt',
    ])
    const transport = JSON.parse(entries.get('transport.json').toString('utf8'))
    assert.equal(transport.protocol, 'wharness.chat-input/v1')
    assert.deepEqual(transport.live_tunnels.map((item) => item.instance_id), ['tunnel-1', 'tunnel-2'])
    assert.deepEqual(transport.knowledge, { protocol: 'legacy', state: 'present', sharing_enabled: true, revision: 0, path: 'knowledge/project.md', version: 3, sha256: knowledgeSha256, updated_by_request_id: 'req_earlier12345678', entries: [] })
    assert.equal(entries.get('knowledge/project.md').toString('utf8'), knowledgeContent)
    assert.match(entries.get('prompt/wharness-planner-prompt.md').toString('utf8'), new RegExp(`Knowledge identity: version=3 sha256=${knowledgeSha256}`))
    assert.equal(entries.get('context/src/App.tsx').toString('utf8'), 'export const x = 1\n')
    assert.equal(entries.get('attachments/notes.txt').toString('utf8'), 'notes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('v2 project knowledge is transported as independently named files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-knowledge-v2-'))
  try {
    const requestId = 'req_20260908T193332_knowledgev2'
    const target = path.join(root, chatInputArchiveFilename('chat-v2', requestId))
    const entriesInput = [
      { id: 'apply-order', content: 'Persist staged knowledge only after host Apply succeeds.', version: 2, updated_by_request_id: 'req_apply' },
      { id: 'desktop-upload', content: 'Use the dedicated file input to preserve canonical bundle names.', version: 1, updated_by_request_id: 'req_upload' },
    ]
    const hash = (await import('node:crypto')).createHash('sha256')
    for (const entry of [...entriesInput].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      hash.update(Buffer.from(entry.id, 'utf8')); hash.update(Buffer.from([0])); hash.update(Buffer.from(entry.content, 'utf8')); hash.update(Buffer.from([0]))
    }
    const knowledgeSha256 = hash.digest('hex')
    await writeChatInputArchive(target, {
      requestId,
      prompt: '# Planner\n\nPROJECT KNOWLEDGE PROTOCOL — harness.knowledge/v2\nKnowledge identity: revision=7 entries=2\n',
      knowledge: { state: 'present', protocol: 'harness.knowledge/v2', sharing_enabled: true, revision: 7, sha256: knowledgeSha256, entries: entriesInput },
    })
    const archive = storedEntries(await readFile(target))
    assert.deepEqual([...archive.keys()], ['transport.json', 'prompt/wharness-planner-prompt.md', 'knowledge/apply-order.md', 'knowledge/desktop-upload.md'])
    assert.equal(archive.get('knowledge/apply-order.md').toString('utf8'), entriesInput[0].content)
    const transport = JSON.parse(archive.get('transport.json').toString('utf8'))
    assert.equal(transport.knowledge.protocol, 'harness.knowledge/v2')
    assert.equal(transport.knowledge.revision, 7)
    assert.deepEqual(transport.knowledge.entries.map((entry) => entry.path), ['knowledge/apply-order.md', 'knowledge/desktop-upload.md'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a persisted pre-v2 prompt is upgraded at the archive boundary without losing its task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-knowledge-v2-compat-'))
  try {
    const requestId = 'req_20260908T193332_legacyv2'
    const target = path.join(root, chatInputArchiveFilename('chat-v2', requestId))
    await writeChatInputArchive(target, {
      requestId,
      prompt: '# Original pending task\n\nKeep the exact user goal.',
      knowledge: { state: 'none', protocol: 'harness.knowledge/v2', sharing_enabled: true, revision: 9, sha256: '', entries: [] },
    })
    const prompt = storedEntries(await readFile(target)).get('prompt/wharness-planner-prompt.md').toString('utf8')
    assert.match(prompt, /Original pending task[\s\S]*harness\.knowledge\/v2 \(compatibility transport\)/)
    assert.match(prompt, /sharing=on; revision=9; entries=0/)
    assert.match(prompt, /ONLY top-level keys protocol, base_revision, mode, entries/)
    assert.match(prompt, /never add request_id/)
    assert.match(prompt, /base_revision=9 and mode=replace/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local bootstrap points the model at the prompt inside the single archive', () => {
  const requestId = 'req_20260905T083123_example123'
  const archive = chatInputArchiveFilename('chat-1', requestId)
  const bootstrap = localChatInputBootstrap(requestId, archive, `whx_bundle_res_chat-1_${requestId}.zip`)
  assert.match(bootstrap, new RegExp(archive.replaceAll('.', '\\.')))
  assert.match(bootstrap, /prompt\/wharness-planner-prompt\.md/)
  assert.match(bootstrap, new RegExp(`whx_bundle_res_chat-1_${requestId}\\.zip`))
  assert.doesNotMatch(bootstrap, /Return the bundle|USER REQUEST|PROJECT MANIFEST/)
  assert.equal(bootstrap.split('\n').length, 2)
})

test('local bootstrap exposes selected tunnel links directly without duplicating the task prompt', () => {
  const requestId = 'req_20260905T083123_example123'
  const archive = chatInputArchiveFilename('chat-1', requestId)
  const bootstrap = localChatInputBootstrap(requestId, archive, `whx_bundle_res_chat-1_${requestId}.zip`, [
    { provider: 'cloudflare', instance_id: 'primary', status: 'https://example.test/status', manifest: 'https://example.test/token/manifest.json' },
  ])
  assert.match(bootstrap, /TUNNELS DIRECT LINKS:/)
  assert.match(bootstrap, /https:\/\/example\.test\/status/)
  assert.match(bootstrap, /https:\/\/example\.test\/token\/manifest\.json/)
  assert.doesNotMatch(bootstrap, /Return the bundle|PROJECT MANIFEST/)
})

test('input archive filename rejects non-canonical request ids', () => {
  assert.throws(() => chatInputArchiveFilename('chat-1', 'request-1'), /Invalid Wharness request id/)
})

test('a task comment with several attachments still becomes one ZIP', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-comment-'))
  try {
    const requestId = 'req_20260905T083123_example123'
    const filename = commentAttachmentArchiveFilename('chat-1', requestId)
    const target = path.join(root, filename)
    const result = await writeCommentAttachmentArchive(target, {
      attachments: [
        { name: 'screenshot.png', bytes: Buffer.from('png-bytes') },
        { name: 'notes.txt', bytes: Buffer.from('notes') },
      ],
    })
    const raw = await readFile(target)
    const entries = storedEntries(raw)
    assert.equal(raw.byteLength, result.bytes)
    assert.equal(result.fileCount, 2)
    assert.deepEqual([...entries.keys()], ['attachments/screenshot.png', 'attachments/notes.txt'])
    assert.equal(entries.get('attachments/screenshot.png').toString('utf8'), 'png-bytes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty comment attachment set refuses to produce an archive', async () => {
  await assert.rejects(() => writeCommentAttachmentArchive('/tmp/unused.zip', { attachments: [] }), /requires at least one attachment/)
})
