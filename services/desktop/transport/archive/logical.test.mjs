import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { chatInputArchiveFilename, writeChatInputArchive } from './index.mjs'
import { storedEntries } from '../chat-input-zip-test-helper.mjs'

function contextMaps() {
  return [
    { path: 'context-map/main/maps', content: '{"protocol":"harness.context-map/v1","entries":[]}\n' },
    { path: 'context-map/main/sensitive-file-map', content: '# harness.sensitive-file-map/v1\nPASSWORD=<<configured>>\n' },
  ]
}

test('aborted request preparation does not leave a partial chat input ZIP', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-chat-input-abort-'))
  try {
    const requestId = 'req_20260919T082150_aborttest'
    const target = path.join(root, chatInputArchiveFilename('chat-abort', requestId))
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(writeChatInputArchive(target, {
      requestId,
      prompt: '# Planner\n\nDo not write a cancelled request.',
      knowledge: { state: 'none', protocol: 'harness.knowledge/v2', sharing_enabled: true, revision: 70, sha256: '', entries: [] },
      signal: controller.signal,
    }), { name: 'AbortError' })
    await assert.rejects(readFile(target), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('direct ChatGPT input is one ZIP with prompt, context, artifacts and user files and no tunnel endpoint', async () => {
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
      context: { maps: contextMaps(), bytes: Buffer.from('UEsDBBQAAAAIAFpiJl1Dv6ajBAAAAAIAAAANAAAAbWFuaWZlc3QuanNvbquuBQBQSwMEFAAAAAgAWmImXU5FPCsVAAAAEwAAAAsAAABzcmMvQXBwLnRzeEutKMgvKlFIzs8rLlGoULBVMOQCAFBLAQIUAxQAAAAIAFpiJl1Dv6ajBAAAAAIAAAANAAAAAAAAAAAAAACAAQAAAABtYW5pZmVzdC5qc29uUEsBAhQDFAAAAAgAWmImXU5FPCsVAAAAEwAAAAsAAAAAAAAAAAAAAIABLwAAAHNyYy9BcHAudHN4UEsFBgAAAAACAAIAdAAAAG0AAAAAAA==', 'base64') },
      artifacts: [{ name: 'result.md', bytes: Buffer.from('result') }],
      attachments: [{ name: 'notes.txt', bytes: Buffer.from('notes') }],
      projectFiles: ['src/App.tsx'],
    })
    const raw = await readFile(target)
    const entries = storedEntries(raw)
    assert.equal(raw.byteLength, result.bytes)
    assert.equal(result.fileCount, 12)
    assert.equal(result.requestMetadata.protocol, 'harness.request-metadata/v1')
    assert.deepEqual([...entries.keys()], [
      'transport.json',
      'prompt/wharness-planner-prompt.md',
      'knowledge/project.md',
      'git-context/index.json',
      'git-context/main/uncommited/diff',
      'context/manifest.json',
      'context/src/App.tsx',
      'context-map/main/maps',
      'context-map/main/sensitive-file-map',
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
    assert.deepEqual(transport.live_tunnels, [])
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
    assert.equal(entries.get('context-map/main/sensitive-file-map').toString('utf8'), '# harness.sensitive-file-map/v1\nPASSWORD=<<configured>>\n')
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
      context: { bytes: contextBytes, maps: contextMaps() },
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
      maps: 'context-map/',
      sources_index: 'metadata/context-sources.json',
    })
    const prompt = entries.get('prompt/wharness-planner-prompt.md').toString('utf8')
    assert.match(prompt, /REQUEST ARCHIVE CONTEXT ROOTS/)
    assert.match(prompt, /ref-context\/<project>/)
    assert.match(prompt, /att-context\/attach-<slot>/)
    assert.match(prompt, /context-map\//)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
