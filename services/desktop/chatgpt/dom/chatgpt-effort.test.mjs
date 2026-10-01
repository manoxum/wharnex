import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureChatGPTReasoningEffort, normalizeChatGPTReasoningEffort } from './chatgpt-effort.mjs'

test('reasoning effort accepts only the three levels observed on ChatGPT', () => {
  for (const level of ['instant', 'medium', 'high']) assert.equal(normalizeChatGPTReasoningEffort(level), level)
  assert.equal(normalizeChatGPTReasoningEffort(''), 'high')
  assert.throws(() => normalizeChatGPTReasoningEffort('light'), /Unsupported/)
})

test('reasoning effort does nothing when the composer already matches', async () => {
  let cycles = 0
  const result = await ensureChatGPTReasoningEffort({
    target: 'instant', observe: async () => ({ ok: true, effort: 'instant' }),
    cycle: async () => { cycles += 1 }, wait: async () => {},
  })
  assert.deepEqual(result, { effort: 'instant', changed: false, cycles: 0 })
  assert.equal(cycles, 0)
})

test('reasoning effort cycles through the bounded structural state until verified', async () => {
  const states = ['high', 'instant', 'medium']
  let index = 0
  const result = await ensureChatGPTReasoningEffort({
    target: 'medium', observe: async () => ({ ok: true, effort: states[index] }),
    cycle: async () => { index += 1 }, wait: async () => {},
  })
  assert.deepEqual(result, { effort: 'medium', changed: true, cycles: 2 })
})

test('reasoning effort fails closed on an absent control or a cycle that has no effect', async () => {
  await assert.rejects(() => ensureChatGPTReasoningEffort({
    target: 'high', observe: async () => ({ ok: false, state: 'effort-control-unavailable' }), cycle: async () => {},
  }), /effort-control-unavailable/)
  await assert.rejects(() => ensureChatGPTReasoningEffort({
    target: 'instant', observe: async () => ({ ok: true, effort: 'high' }), cycle: async () => {}, wait: async () => {},
  }), /did not reach instant after bounded cycling/)
})
