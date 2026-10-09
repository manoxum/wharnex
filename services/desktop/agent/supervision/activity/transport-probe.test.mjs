import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransportShapeProbe } from './transport-probe.mjs'

test('diagnostic chrome observation is opt-in, bounded and deduplicated', async () => {
  let clock = 1
  let reads = 0
  const logs = []
  const entry = { view: { webContents: { executeJavaScript: async () => { reads += 1; return { viewport: { w: 1280, h: 900 }, controls: [{ tag: 'BUTTON', disabled: true, secret: 'discard' }] } } } } }
  const off = createTransportShapeProbe({ enabled: () => false })
  await off('chat', entry)
  assert.equal(reads, 0)
  const probe = createTransportShapeProbe({ enabled: () => true, now: () => clock, log: (line) => logs.push(line) })
  await probe('chat', entry)
  await probe('chat', entry)
  assert.equal(reads, 2)
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs[0], /secret|discard/)
  clock += 30_000
  await probe('chat', entry)
  assert.equal(reads, 4)
  assert.equal(logs.length, 1)
  entry.transportPreparationCount = 1
  clock += 30_000
  await probe('chat', entry)
  assert.equal(reads, 4)
})

test('a failed diagnostic never interrupts supervision', async () => {
  const probe = createTransportShapeProbe({ enabled: () => true })
  await assert.doesNotReject(probe('chat', { view: { webContents: { executeJavaScript: async () => { throw new Error('renderer unavailable') } } } }))
})
