import test from 'node:test'
import assert from 'node:assert/strict'
import { notifyChatGPTAccountChanged, onChatGPTAccountChanged } from './account-change.mjs'

test('account changes reach every subscriber and survive a failing one', () => {
  const seen = []
  const offFailing = onChatGPTAccountChanged(() => { throw new Error('boom') })
  const off = onChatGPTAccountChanged((reason) => seen.push(reason))
  notifyChatGPTAccountChanged('login-external')
  off(); offFailing()
  notifyChatGPTAccountChanged('session-cleared')
  assert.deepEqual(seen, ['login-external'])
})
