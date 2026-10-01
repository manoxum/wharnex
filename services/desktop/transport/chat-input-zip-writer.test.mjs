import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeChatInputZip } from './chat-input-zip-writer.mjs'
import { storedEntries } from './chat-input-zip-test-helper.mjs'

test('request ZIP deflates text, stores binary and preserves every expanded byte', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wharnex-zip-test-'))
  try {
    const target = path.join(dir, 'request.zip')
    const text = Buffer.from(Array.from({ length: 20_000 }, (_, index) => `const answer_${index} = ${index * 7}\n`).join(''))
    const binary = randomBytes(32 * 1024)
    await writeChatInputZip(target, [
      { name: 'context/example.ts', bytes: text },
      { name: 'attachments/random.bin', bytes: binary },
      { name: 'transport.json', bytes: Buffer.from('{}') },
    ])
    const raw = await readFile(target)
    const entries = storedEntries(raw)
    assert.deepEqual(entries.get('context/example.ts'), text)
    assert.deepEqual(entries.get('attachments/random.bin'), binary)
    assert.equal(raw.readUInt16LE(8), 8)
    assert.ok(raw.length < text.length / 2 + binary.length)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
