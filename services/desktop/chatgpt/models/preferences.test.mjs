import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatGPTModelPreferences } from './preferences.mjs'

test('confirmed per-chat choices survive Desktop restart without crossing chat identities', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wharnex-model-preferences-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const original = createChatGPTModelPreferences(directory)
  assert.equal(await original.get('chat_a'), '')
  await Promise.all([original.set('chat_a', 'account_alpha'), original.set('chat_b', 'account_beta')])
  const restarted = createChatGPTModelPreferences(directory)
  assert.equal(await restarted.get('chat_a'), 'account_alpha')
  assert.equal(await restarted.get('chat_b'), 'account_beta')
  assert.equal(await restarted.get('chat_c'), '')
  assert.equal((await stat(join(directory, 'wharnex-chat-models-v1.json'))).mode & 0o777, 0o600)
})
