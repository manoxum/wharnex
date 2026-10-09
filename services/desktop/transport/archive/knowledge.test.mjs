import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { chatInputArchiveFilename, writeChatInputArchive } from './index.mjs'
import { storedEntries } from '../chat-input-zip-test-helper.mjs'

test('v2 project knowledge is transported as independently named files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharness-knowledge-v2-'))
  try {
    const requestId = 'req_20260908T193332_knowledgev2'
    const target = path.join(root, chatInputArchiveFilename('chat-v2', requestId))
    const entriesInput = [
      { id: 'apply-order', content: 'Persist staged knowledge only after host Apply succeeds.', category: 'protocol_transport', version: 2, updated_by_request_id: 'req_apply' },
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
    assert.deepEqual(transport.knowledge.entries.map((entry) => entry.category), ['protocol_transport', 'general'])
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
    assert.match(prompt, /id, file, sha256, category/)
    assert.match(prompt, /product_domain/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
