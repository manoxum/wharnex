import test from 'node:test'
import assert from 'node:assert/strict'
import { registerNativeShutdown } from './shutdown.mjs'

test('Desktop exit waits for native runtime state and EOF exactly once without replay', async () => {
  let handler, finish, prevented = 0, closes = 0, quits = 0
  registerNativeShutdown({ on: (_event, callback) => { handler = callback }, quit: () => { quits++ } }, () => ({ close: () => { closes++; return new Promise((resolve) => { finish = resolve }) } }))
  const event = { preventDefault: () => { prevented++ } }
  handler(event); handler(event)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(prevented, 2); assert.equal(closes, 1); assert.equal(quits, 0)
  finish(); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(quits, 1); handler(event); assert.equal(prevented, 2)
})
