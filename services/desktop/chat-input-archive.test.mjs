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
    const gitIndexContent = '{\"protocol\":\"harness.git-context/v1\",\"state\":\"present\"}\n'
    const gitDiffContent = 'diff --git a/src/App.tsx b/src/App.tsx\n'
    const crypto = await import('node:crypto')
    const digest = (value) => crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')
    const result = await writeChatInputArchive(target, {
      requestId,
      requestMetadata: {
        chat_title: 'Temporary title',
        chat_id: 'chat-1',
        chat_hash: 'a'.repeat(64),
        requested_at: '2026-09-15T23:04:43.000Z',
      },
      prompt: `# Planner\n\nPROJECT KNOWLEDGE\nKnowledge identity: version=3 sha256=${knowledgeSha256}\n${knowledgeContent}\nReturn the bundle.`,
      knowledge: { state: 'present', content: knowledgeContent, version: 3, sha256: knowledgeSha256, updated_by_request_id: 'req_earlier12345678' },
      gitContext: {
        protocol: 'harness.git-context/v1', state: 'present', root: 'git-context/', index: 'git-context/index.json', ref: 'main', ref_path: 'git-context/main/', head_sha: 'a'.repeat(40), upstream: 'origin/main', has_upstream: true, ahead: 1, behind: 0,
        files: [
          { path: 'git-context/index.json', content: gitIndexContent, sha256: digest(gitIndexContent), bytes: Buffer.byteLength(gitIndexContent) },
          { path: 'git-context/main/uncommited/diff', content: gitDiffContent, sha256: digest(gitDiffContent), bytes: Buffer.byteLength(gitDiffContent) },
        ],
      },
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
    assert.equal(result.fileCount, 10)
    assert.equal(result.requestMetadata.protocol, 'harness.request-metadata/v1')
    assert.deepEqual([...entries.keys()], [
      'transport.json',
      'prompt/wharness-planner-prompt.md',
      'knowledge/project.md',
      'git-context/index.json',
      'git-context/main/uncommited/diff',
      'context/manifest.json',
      'context/src/App.tsx',
      'references/project-files.json',
      'artifacts/result.md',
      'attachments/notes.txt',
    ])
    const transport = JSON.parse(entries.get('transport.json').toString('utf8'))
    assert.equal(transport.protocol, 'wharness.chat-input/v1')
    assert.deepEqual(transport.request_metadata, {
      protocol: 'harness.request-metadata/v1',
      chat_title: 'Temporary title',
      chat_id: 'chat-1',
      chat_hash: 'a'.repeat(64),
      requested_at: '2026-09-15T23:04:43.000Z',
    })
    assert.deepEqual(transport.live_tunnels.map((item) => item.instance_id), ['tunnel-1', 'tunnel-2'])
    assert.equal(transport.git_context.protocol, 'harness.git-context/v1')
    assert.equal(transport.git_context.ref, 'main')
    assert.deepEqual(transport.git_context.files.map((item) => item.path), ['git-context/index.json', 'git-context/main/uncommited/diff'])
    assert.deepEqual(transport.knowledge, { protocol: 'legacy', state: 'present', sharing_enabled: true, revision: 0, path: 'knowledge/project.md', version: 3, sha256: knowledgeSha256, updated_by_request_id: 'req_earlier12345678', entries: [] })
    assert.equal(entries.get('knowledge/project.md').toString('utf8'), knowledgeContent)
    const prompt = entries.get('prompt/wharness-planner-prompt.md').toString('utf8')
    assert.match(prompt, /WHARNEX REQUEST METADATA/)
    assert.match(prompt, /ChatTitle: Temporary title/)
    assert.match(prompt, /ChatId: chat-1/)
    assert.match(prompt, new RegExp(`ChatHash: ${'a'.repeat(64)}`))
    assert.match(prompt, /RequestedAt: 2026-09-15T23:04:43.000Z/)
    assert.match(prompt, new RegExp(`Knowledge identity: version=3 sha256=${knowledgeSha256}`))
    assert.equal(entries.get('context/src/App.tsx').toString('utf8'), 'export const x = 1\n')
    assert.equal(entries.get('attachments/notes.txt').toString('utf8'), 'notes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('workspace context is separated into primary, ref and attach roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-context-roots-'))
  try {
    const requestId = 'req_20260917T210614_contextroots'
    const target = path.join(root, chatInputArchiveFilename('chat-roots', requestId))
    const contextBytes = Buffer.from('UEsDBBQAAAAIAA+qMV1sZRs2CgAAAAgAAAALAAAAcHJpbWFyeS50eHQrKMrMTSyq5AIAUEsDBBQAAAAIAA+qMV2nwrjCCgAAAAgAAAAgAAAAUkVMQVRFRF9QUk9KRUNUUy8wMS1jb3JlL2FwaS50eHQrSs1JLElN4QIAUEsDBBQAAAAIAA+qMV2jl98zCQAAAAcAAAAkAAAAQVRUQUNITUVOVFMvMDEtY29udHJhY3RzL29wZW5hcGkueW1syy9IzUssyAQAUEsDBBQAAAAIAA+qMV3t7JrQLwEAAGICAAAVAAAAUkVMQVRFRF9QUk9KRUNUUy5qc29upVDLTsMwEPyVymfaUCRA4laVSAjxUskNVdHW2RBTx47WTklU5d/xpgm0veLTPmbWM7MXFVlvpdXibiIKIIPOzQg1eMymYfeF0rtoNxcXkwBVJVCbDmNmRN+Wtq4CiVEJyjBqII8oF2AfezF0aQW+OCNKS8hEAyXyauwrwlw1PFnFT4skvk/fVq+P8TJ5jy7nU0ZFDCvBqBwdy9kLlfUXfHM4cPiTrD0XO/7hCri6vuHl5p+Pr+VKY+93HRpspK4zzMbeY+NTT7WRHE+Y5qAddh3vwHuQBYcW4hkS+1XtaBf0Gk/AaZ4EdTTcKtN7zxQFz5ba0wgXSbJYPjzHL2N6AzU61j0P9ab1fX0bamUOFv5kCVuhgUrN2lKLdXfwibL2ypqUat3r0vgJsp30bfcDUEsBAhQDFAAAAAgAD6oxXWxlGzYKAAAACAAAAAsAAAAAAAAAAAAAAIABAAAAAHByaW1hcnkudHh0UEsBAhQDFAAAAAgAD6oxXafCuMIKAAAACAAAACAAAAAAAAAAAAAAAIABMwAAAFJFTEFURURfUFJPSkVDVFMvMDEtY29yZS9hcGkudHh0UEsBAhQDFAAAAAgAD6oxXaOX3zMJAAAABwAAACQAAAAAAAAAAAAAAIABewAAAEFUVEFDSE1FTlRTLzAxLWNvbnRyYWN0cy9vcGVuYXBpLnltbFBLAQIUAxQAAAAIAA+qMV3t7JrQLwEAAGICAAAVAAAAAAAAAAAAAACAAcYAAABSRUxBVEVEX1BST0pFQ1RTLmpzb25QSwUGAAAAAAQABAAcAQAAKAIAAAAA', 'base64')
    await writeChatInputArchive(target, {
      requestId,
      prompt: '# Planner',
      knowledge: { state: 'none' },
      context: { bytes: contextBytes },
    })
    const entries = storedEntries(await readFile(target))
    assert.ok(entries.has('context/primary.txt'))
    assert.ok(entries.has('ref-context/01-core/api.txt'))
    assert.ok(entries.has('att-context/attach-01/openapi.yml'))
    assert.ok(entries.has('metadata/context-sources.json'))
    assert.equal(entries.has('context/RELATED_PROJECTS/01-core/api.txt'), false)
    assert.equal(entries.has('context/ATTACHMENTS/01-contracts/openapi.yml'), false)
    const sources = JSON.parse(entries.get('metadata/context-sources.json').toString('utf8'))
    assert.equal(sources.protocol, 'harness.context-sources/v1')
    assert.equal(sources.related_projects[0].prefix, 'ref-context/01-core/')
    assert.equal(sources.attached_paths[0].prefix, 'att-context/attach-01/')
    const transport = JSON.parse(entries.get('transport.json').toString('utf8'))
    assert.deepEqual(transport.context_roots, {
      primary: 'context/',
      references: 'ref-context/',
      attached_paths: 'att-context/',
      sources_index: 'metadata/context-sources.json',
    })
    const prompt = entries.get('prompt/wharness-planner-prompt.md').toString('utf8')
    assert.match(prompt, /REQUEST ARCHIVE CONTEXT ROOTS/)
    assert.match(prompt, /ref-context\/<project>/)
    assert.match(prompt, /att-context\/attach-<slot>/)
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

test('local bootstrap exposes the same engine-owned request metadata as the archive', () => {
  const requestId = 'req_20260905T083123_example123'
  const archive = chatInputArchiveFilename('chat-1', requestId)
  const bootstrap = localChatInputBootstrap(requestId, archive, `whx_bundle_res_chat-1_${requestId}.zip`, [], {
    chat_title: 'Temporary title', chat_id: 'chat-1', chat_hash: 'b'.repeat(64), requested_at: '2026-09-15T23:04:43Z',
  })
  assert.match(bootstrap, /WHARNEX REQUEST METADATA/)
  assert.match(bootstrap, /ChatTitle: Temporary title/)
  assert.match(bootstrap, /ChatId: chat-1/)
  assert.match(bootstrap, new RegExp(`ChatHash: ${'b'.repeat(64)}`))
  assert.match(bootstrap, /RequestedAt: 2026-09-15T23:04:43.000Z/)
})

test('input archive filename rejects non-canonical request ids', () => {
  assert.throws(() => chatInputArchiveFilename('chat-1', 'request-1'), /Invalid Wharnex request id/)
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

test('a continuation request carries its attempt ledger and divergence report as real files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-input-'))
  try {
    const requestId = 'req_20260912T101500_continuation1'
    const target = path.join(root, chatInputArchiveFilename('chat-1', requestId))
    const ledger = '## Does not work locally\n- npm ci: the runner image has no network\n'
    const patch = 'diff --git a/a.go b/a.go\n@@\n-old\n+new\n'
    const result = await writeChatInputArchive(target, {
      requestId,
      prompt: '# Planner\n\nSESSION ATTEMPT LEDGER\nReturn the bundle.',
      knowledge: { state: 'none' },
      continuation: [
        { path: 'requests/main.md', content_base64: Buffer.from('Pedido inicial').toString('base64') },
        { path: 'requests/adjustment.md', content_base64: Buffer.from('Ajustar apenas a UI').toString('base64') },
        { path: 'attempts/state.json', content_base64: Buffer.from('{"protocol":"harness.attempts/v1"}').toString('base64') },
        { path: 'attempts/ledger.md', content_base64: Buffer.from(ledger).toString('base64') },
        { path: 'attempts/events.json', content_base64: Buffer.from('{"protocol":"harness.execution-history/v1","events":[]}').toString('base64') },
        { path: 'context-delta/delta.json', content_base64: Buffer.from('{"protocol":"harness.context-delta/v1"}').toString('base64') },
        { path: 'context-delta/delta.patch', content_base64: Buffer.from(patch).toString('base64') },
        { path: 'responses/index.json', content_base64: Buffer.from('{"protocol":"harness.response-history/v1"}').toString('base64') },
        { path: 'responses/001-req_root.zip', content_base64: Buffer.from('PK prior response').toString('base64') },
      ],
    })
    const raw = await readFile(target)
    const entries = storedEntries(raw)
    assert.equal(raw.byteLength, result.bytes)
    assert.deepEqual([...entries.keys()], [
      'transport.json',
      'prompt/wharness-planner-prompt.md',
      'requests/main.md',
      'requests/adjustment.md',
      'attempts/state.json',
      'attempts/ledger.md',
      'attempts/events.json',
      'context-delta/delta.json',
      'context-delta/delta.patch',
      'responses/index.json',
      'responses/001-req_root.zip',
    ])
    assert.equal(entries.get('attempts/ledger.md').toString('utf8'), ledger)
    assert.equal(entries.get('context-delta/delta.patch').toString('utf8'), patch)
    const manifest = JSON.parse(entries.get('transport.json').toString('utf8'))
    assert.deepEqual(manifest.continuation.map((item) => item.path), [
      'requests/main.md', 'requests/adjustment.md', 'attempts/state.json', 'attempts/ledger.md', 'attempts/events.json', 'context-delta/delta.json', 'context-delta/delta.patch', 'responses/index.json', 'responses/001-req_root.zip',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Continuation paths are a fixed Wharnex-owned allowlist. Accepting an
// arbitrary path would turn a backend response into a write primitive over the
// archive layout.
test('an unexpected continuation path is refused rather than sanitized', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-input-'))
  try {
    const requestId = 'req_20260912T101500_continuation2'
    const target = path.join(root, chatInputArchiveFilename('chat-1', requestId))
    await assert.rejects(() => writeChatInputArchive(target, {
      requestId,
      prompt: '# Planner\n',
      knowledge: { state: 'none' },
      continuation: [{ path: '../escape.md', content_base64: Buffer.from('x').toString('base64') }],
    }), /Unsupported continuation artifact/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a multi-file conflict capsule travels in the ZIP beyond the prompt limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-input-'))
  try {
    const requestId = 'req_20260914T192304_conflict'
    const target = path.join(root, chatInputArchiveFilename('chat-1', requestId))
    const capsule = Buffer.alloc(2 << 20, 0x78)
    await writeChatInputArchive(target, {
      requestId,
      prompt: '# Conflict\n\nRead conflict/capsule.json.',
      knowledge: { state: 'none' },
      continuation: [{ path: 'conflict/capsule.json', content_base64: capsule.toString('base64') }],
    })
    const entries = storedEntries(await readFile(target))
    assert.equal(entries.get('conflict/capsule.json').byteLength, capsule.byteLength)
    assert.equal(entries.get('prompt/wharness-planner-prompt.md').byteLength < (1 << 20), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
