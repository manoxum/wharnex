import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatGPTAccountProviderChain } from './chatgpt-account-provider.mjs'

test('prefers an explicitly supported official API capability', async () => {
  const chain = new ChatGPTAccountProviderChain({
    official: { supports: (action) => action === 'rename-conversation', run: async () => ({ ok: true, state: 'renamed' }) },
    browser: { run: async () => { throw new Error('fallback must not run') } },
  })
  assert.deepEqual(await chain.run('rename-conversation', {}), { ok: true, state: 'renamed', provider: 'official-api' })
})

test('uses typed browser fallback without accepting arbitrary actions', async () => {
  const chain = new ChatGPTAccountProviderChain({ browser: { run: async () => ({ ok: true, state: 'done' }) } })
  assert.deepEqual(await chain.run('hide-sidebar', {}), { ok: true, state: 'done', provider: 'typed-browser' })
  await assert.rejects(() => chain.run('read-cookies', {}), /Unsupported/)
})
