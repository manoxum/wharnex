import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCodexAccounts } from './profiles.mjs'

test('named accounts isolate runtime credentials, persist selection and never export auth data', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-accounts-')); t.after(() => rm(root, { recursive: true, force: true }))
  const options = [], handlers = { accountChanged() {}, notification() {}, request() {}, exit() {} }
  const rpcFactory = (settings) => { options.push(settings); return { stop: async () => {} } }
  const accounts = createCodexAccounts({ root, rpcFactory, handlers })
  const a = await accounts.create('Trabalho'), b = await accounts.create('Pessoal')
  await accounts.runtime(a.id); await accounts.runtime(b.id)
  assert.notEqual(options[0].environment.CODEX_HOME, options[1].environment.CODEX_HOME)
  assert.ok(options.every((option) => option.configArgs.includes('cli_auth_credentials_store="file"')))
  await accounts.observe(a.id, { type: 'chatgpt', email: 'a@example.test', planType: 'plus', accessToken: 'private-token' }, { primary: { usedPercent: 100 } })
  await accounts.select(a.id)
  assert.doesNotMatch(await readFile(path.join(root, 'accounts.json'), 'utf8'), /private-token|accessToken/)
  const restored = createCodexAccounts({ root, rpcFactory, handlers })
  assert.equal(await restored.selected(), a.id)
  assert.equal((await restored.list()).profiles[1].account.email, 'a@example.test')
  await assert.rejects(accounts.select('../auth.json'), /desconhecida/)
  await assert.rejects(accounts.create(''), /inválido/)
})
