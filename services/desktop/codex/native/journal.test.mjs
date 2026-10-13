import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createNativeJournal } from './journal.mjs'

test('native ledger redacts nested outputs, echoed secret answers and full environment inventories', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-native-journal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const journal = createNativeJournal(root)
  journal.protectSecret('opaque-user-credential')
  await journal.append({ requestId: 'req_example', chatId: 'chat' }, 'turn/completed', { turn: { items: [
    { type: 'commandExecution', output: ['token=example-private-token', { env: { PATH: '/private/bin' } }, 'opaque-user-credential', 'PATH=/bin\nLANG=en_US\nUSER=test'] },
    { id: 'reasoning', type: 'reasoning', summary: ['Public summary'], content: ['private reasoning'] },
  ] } })
  const result = await readFile(path.join(root, 'history', 'req_example.jsonl'), 'utf8')
  assert.match(result, /Public summary/); assert.match(result, /REDACTED ENVIRONMENT/)
  assert.doesNotMatch(result, /example-private-token|opaque-user-credential|private reasoning|private\/bin|LANG=en_US/)
  assert.equal(journal.sanitize('x'.repeat(100000)).length, 65536)
})
