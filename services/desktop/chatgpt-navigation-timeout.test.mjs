import assert from 'node:assert/strict'
import test from 'node:test'
import { withChatGPTNavigationDeadline } from './chatgpt-navigation-timeout.mjs'

test('a navigation that never settles is stopped and releases its caller', async () => {
  let stopped = 0
  const startedAt = Date.now()

  await assert.rejects(
    withChatGPTNavigationDeadline(
      () => new Promise(() => undefined),
      () => { stopped += 1 },
      10,
    ),
    (error) => error?.code === 'WHARNEX_CHATGPT_NAVIGATION_TIMEOUT',
  )

  assert.equal(stopped, 1)
  assert.ok(Date.now() - startedAt < 250)
})

test('a completed navigation clears its deadline without stopping the page', async () => {
  let stopped = 0
  const result = await withChatGPTNavigationDeadline(
    async () => 'loaded',
    () => { stopped += 1 },
    100,
  )

  assert.equal(result, 'loaded')
  assert.equal(stopped, 0)
})
