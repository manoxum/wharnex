import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('independent Supervisor instances do not share a transport queue', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function withChatGPTSupervisorTransport(')
  const end = source.indexOf('\nfunction sendToWindowState', start)
  const helper = source.slice(start, end)

  assert.ok(start >= 0)
  assert.doesNotMatch(helper, /chatGPTSupervisorTransportTail/)
  assert.doesNotMatch(helper, /waitForDifferentSupervisorTransport/)
  assert.match(helper, /withChatGPTTransportPreparation\(key, entry, requestId/)
})

test('a queued or active transport prevents its Supervisor from being released', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const holdStart = source.indexOf('function supervisorBindingHold(')
  const holdEnd = source.indexOf('\nfunction supervisorBindingHeld', holdStart)
  const releaseStart = source.indexOf('function releaseChatGPTView(')
  const releaseEnd = source.indexOf('\nfunction setChatGPTBounds', releaseStart)

  assert.match(source.slice(holdStart, holdEnd), /chatGPTTransportTails\.has\(`chat:\$\{key\}`\)/)
  assert.match(source.slice(releaseStart, releaseEnd), /supervisorBindingHeld\(key, entry\)/)
})

test('throttle reconciliation tolerates a renderer closed during cleanup', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function reconcileChatGPTThrottle(')
  const end = source.indexOf('\nfunction chatGPTTransportAbortKey', start)

  assert.match(source.slice(start, end), /entry\?\.view\?\.webContents/)
})
