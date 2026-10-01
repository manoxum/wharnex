import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTRendererStability } from './index.mjs'

function fixture(evaluate) {
  const events = []
  const wc = { getURL: () => 'https://chatgpt.com/c/owned', isLoading: () => false }
  const operations = createChatGPTRendererStability({
    sanitizeChatCacheKey: (value) => value,
    requireOwnedChatGPTEntry: () => ({ wc }),
    evaluateChatGPTDOMWithDeadline: evaluate,
    wait: async (ms) => { events.push(`wait:${ms}`) },
    waitForChatGPTReady: async () => { events.push('ready') },
    isTrustedChatGPTOrigin: () => true,
    recoverChatGPTConversationLoadFailure: async () => { events.push('recover') },
  })
  return { operations, events }
}

test('DOM evaluation retries once after checking the same owned surface', async () => {
  let attempts = 0
  const { operations, events } = fixture(async () => {
    if (++attempts === 1) throw new Error('renderer busy')
    return { ok: true }
  })
  assert.deepEqual(await operations.executeChatGPTDOMScript('key', {}, 'composer', 'script'), { ok: true })
  assert.equal(attempts, 2)
  assert.deepEqual(events, ['wait:250', 'ready', 'recover'])
})

test('DOM evaluation stops after three attempts with an actionable error', async () => {
  let attempts = 0
  const { operations, events } = fixture(async () => { attempts += 1; throw new Error('renderer busy') })
  await assert.rejects(operations.executeChatGPTDOMScript('key', {}, 'composer', 'script'), /Reabra a aba ChatGPT/)
  assert.equal(attempts, 3)
  assert.deepEqual(events, ['wait:250', 'ready', 'recover', 'wait:250', 'ready', 'recover', 'wait:250'])
})
