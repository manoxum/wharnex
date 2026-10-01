import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopChatGPTAccount } from './desktop.mjs'

test('account composition serializes operations and defers late navigation binding', async () => {
  const d = {
    chatGPTAccountProviders: { run: async (_action, payload, fallback) => fallback(_action, payload) },
    get paceChatGPTWorkerNavigation() { throw new Error('late pacing binding read during composition') },
  }
  const account = createDesktopChatGPTAccount(d)
  const steps = []
  await Promise.all([
    account.serializeChatGPTAccountOperation(async () => {
      steps.push('first-start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      steps.push('first-end')
    }),
    account.serializeChatGPTAccountOperation(async () => { steps.push('second') }),
  ])
  assert.deepEqual(steps, ['first-start', 'first-end', 'second'])
  assert.equal(await account.runChatGPTAccountAction('action', { id: 1 }, (payload) => payload.id), 1)
})
