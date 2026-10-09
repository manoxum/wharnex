import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { chatInputArchiveFilename, writeChatInputArchive } from './index.mjs'
import { storedEntries } from '../chat-input-zip-test-helper.mjs'

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
