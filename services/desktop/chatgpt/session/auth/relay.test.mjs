import assert from 'node:assert/strict'
import test from 'node:test'
import { electronCookieDetails } from '../managed-browser-auth.mjs'
import { relayManagedBrowserCookies } from './relay.mjs'

test('managed browser relay imports only eligible ChatGPT cookies and flushes the partition', async () => {
  const imported = []
  let flushed = 0
  const session = {
    fromPartition: (partition) => {
      assert.equal(partition, 'persist:wharness-chatgpt')
      return {
        cookies: { set: async (details) => imported.push(details) },
        flushStorageData: async () => { flushed++ },
      }
    },
  }
  const count = await relayManagedBrowserCookies({
    session, partition: 'persist:wharness-chatgpt', electronCookieDetails,
    cookies: [
      { domain: '.chatgpt.com', name: 'session', value: 'private' },
      { domain: '.openai.com', name: 'session', value: 'wrong-domain' },
    ],
  })
  assert.equal(count, 1)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].value, 'private')
  assert.equal(flushed, 1)
})

test('managed browser relay rejects an authenticated return without eligible cookies', async () => {
  let flushed = 0
  await assert.rejects(relayManagedBrowserCookies({
    session: {
      fromPartition: () => ({
        cookies: { set: async () => assert.fail('no cookie should be imported') },
        flushStorageData: async () => { flushed++ },
      }),
    },
    partition: 'persist:wharness-chatgpt',
    electronCookieDetails,
    cookies: [{ domain: '.openai.com', name: 'session', value: 'wrong-domain' }],
  }), /nenhuma credencial ChatGPT/)
  assert.equal(flushed, 0)
})
