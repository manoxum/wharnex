import test from 'node:test'
import assert from 'node:assert/strict'
import { chatInputSettleDelay, decodeUserAttachment, normalizeBounds, sanitizeAttachmentFilename, sanitizeChatCacheKey, sanitizeOptionalChatCacheKey, sanitizeDiagnosticURL, sanitizeSessionId } from './security.mjs'

test('session ids are strictly allowlisted', () => {
  assert.equal(sanitizeSessionId('ses_20260902_abc-123'), 'ses_20260902_abc-123')
  assert.throws(() => sanitizeSessionId('../etc/passwd'))
})

test('native view bounds are clamped to window content', () => {
  assert.deepEqual(normalizeBounds({ x: -5, y: 12, width: 900, height: 900 }, { width: 500, height: 400 }), { x: 0, y: 12, width: 500, height: 388 })
  assert.deepEqual(normalizeBounds({ x: 999, y: 999, width: 20, height: 20 }, { width: 500, height: 400 }), { x: 499, y: 399, width: 1, height: 1 })
})

test('diagnostic URLs omit query strings and fragments', () => {
  assert.equal(
    sanitizeDiagnosticURL('https://chatgpt.com/backend-api/conversation?token=secret#frag'),
    'https://chatgpt.com/backend-api/conversation',
  )
})

test('ChatGPT DOM cache keys are local identifiers only', () => {
  assert.equal(sanitizeChatCacheKey('c6c0810a-1234-4abc-a123-1234567890ab'), 'c6c0810a-1234-4abc-a123-1234567890ab')
  assert.throws(() => sanitizeChatCacheKey('../escape'))
  assert.throws(() => sanitizeChatCacheKey(''))
  assert.equal(sanitizeOptionalChatCacheKey(undefined), '')
  assert.equal(sanitizeOptionalChatCacheKey('  '), '')
  assert.equal(sanitizeOptionalChatCacheKey('chat-1'), 'chat-1')
  assert.throws(() => sanitizeOptionalChatCacheKey('../escape'))
})

test('user attachment filenames and payloads cannot escape the temp directory', () => {
  assert.equal(sanitizeAttachmentFilename('requirements (final).pdf'), 'requirements (final).pdf')
  assert.throws(() => sanitizeAttachmentFilename('../secret'))
  assert.throws(() => sanitizeAttachmentFilename('folder/file.txt'))
  assert.throws(() => sanitizeAttachmentFilename('bad\u0000name'))
  assert.throws(() => sanitizeAttachmentFilename('CON.txt'))
  assert.throws(() => sanitizeAttachmentFilename('bad:name.txt'))
  const decoded = decodeUserAttachment({ name: 'note.txt', mime: 'text/plain', contentBase64: Buffer.from('hello').toString('base64') }, 10)
  assert.equal(decoded.name, 'note.txt')
  assert.equal(decoded.mime, 'text/plain')
  assert.equal(decoded.bytes.toString(), 'hello')
  assert.throws(() => decodeUserAttachment({ name: 'large.bin', contentBase64: Buffer.from('too large').toString('base64') }, 2))
  assert.throws(() => decodeUserAttachment({ name: 'bad.bin', contentBase64: '%%%=' }, 10))
  assert.throws(() => decodeUserAttachment({ name: 'bad.bin', mime: 'text/plain; charset=utf-8', contentBase64: Buffer.from('ok').toString('base64') }, 10))
})

test('automatic ChatGPT submission waits longer for larger attachment sets and remains bounded', () => {
  assert.equal(chatInputSettleDelay(0, 0), 1500)
  assert.ok(chatInputSettleDelay(25 * 1024 * 1024, 2) > chatInputSettleDelay(1024, 1))
  assert.equal(chatInputSettleDelay(1024 * 1024 * 1024, 100), 30_000)
})
