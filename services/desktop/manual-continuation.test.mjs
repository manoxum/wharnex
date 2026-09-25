import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `missing ${startMarker}`)
  assert.ok(end > start, `missing ${endMarker}`)
  return source.slice(start, end)
}

test('manual continuation preserves the request-scoped safety checks', () => {
  const handler = sourceBetween(
    "ipcMain.handle('wharness:chatgpt:continue-expected-bundle'",
    "ipcMain.handle('wharness:chatgpt:pick-bundle'",
  )
  assert.match(handler, /reason: 'not_supervised'/)
  assert.match(handler, /entry\.loading \|\| wc\.isLoading\(\)/)
  assert.match(handler, /await waitForChatGPTSurfaceReady\(key, entry\)/)
  assert.match(handler, /classifyChatGPTConversationTransport\(entry\.conversationRequests/)
  assert.match(handler, /reason: 'transport_active'/)
  assert.match(handler, /const staleTransport = transport\.state === 'stale' \|\| entry\.staleConversationRequestIds\.size > 0/)
  assert.match(handler, /reason: staleTransport \? 'transport_stale' : 'processing_ambiguous'/)
  assert.match(handler, /request\?\.force/)
  assert.match(handler, /manualContinuationInFlight/)
  assert.match(handler, /reason: 'continuation_in_flight'/)
})

test('manual continuation uses the compact same-conversation wake-up', () => {
  const handler = sourceBetween(
    "ipcMain.handle('wharness:chatgpt:continue-expected-bundle'",
    "ipcMain.handle('wharness:chatgpt:pick-bundle'",
  )
  assert.match(handler, /submitChatGPTContinuation\(key, affinityURL, requestId, entry, \{ manual: true \}\)/)
  assert.match(handler, /escalateChatGPTContinuationFailure\(key, expected, error, 'manual-continuation'\)/)
  assert.match(handler, /reason: 'continuation_failed'/)
  assert.match(handler, /reason: 'submitted'/)
  assert.doesNotMatch(handler, /fillBundledChatGPTComposer/)
  assert.doesNotMatch(handler, /chatGPTStalledRecoveryPrompt/)
  assert.doesNotMatch(handler, /submitChatGPTDraft/)
})

test('manual continuation bypasses only the one-shot automatic wake limit', () => {
  const blocking = sourceBetween(
    'function automaticChatGPTContinuationBlockReason(',
    '\nfunction chatGPTContinuationSuppressedError',
  )
  const submission = sourceBetween(
    'async function submitChatGPTContinuation(',
    '\nfunction durableWorkspaceChatID',
  )
  assert.match(blocking, /\{ manual = false \} = \{\}/)
  assert.match(blocking, /if \(!manual &&/)
  assert.match(submission, /\{ manual = false \} = \{\}/)
  assert.match(submission, /automaticChatGPTContinuationBlockReason\(key, id, \{ manual \}\)/)
  assert.match(submission, /if \(!manual\) \{/)
})
