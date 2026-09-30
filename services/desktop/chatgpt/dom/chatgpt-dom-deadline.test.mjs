import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateChatGPTDOMWithDeadline } from './chatgpt-dom-deadline.mjs'

test('bounded DOM evaluation returns the renderer result', async () => {
  const webContents = { executeJavaScript: async () => ({ ok: true }) }
  assert.deepEqual(await evaluateChatGPTDOMWithDeadline(webContents, 'allowlisted-script', 20), { ok: true })
})

test('bounded DOM evaluation rejects when a renderer never answers', async () => {
  const webContents = { executeJavaScript: () => new Promise(() => {}) }
  await assert.rejects(evaluateChatGPTDOMWithDeadline(webContents, 'allowlisted-script', 5), /exceeded 5 ms/)
})
