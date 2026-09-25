import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeChatInputTransportArchives } from './chat-input-archive.mjs'
import { storedEntries } from './chat-input-zip-test-helper.mjs'

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
