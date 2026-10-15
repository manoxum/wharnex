import test from 'node:test'
import assert from 'node:assert/strict'
import { codexRPCError } from './errors.mjs'

test('writer ownership conflicts are actionable without exposing raw provider error bodies', () => {
  const error = codexRPCError('thread/resume', { code: -32600, message: 'thread 00000000-0000-4000-8000-000000000001 already has an active writer' })
  assert.equal(error.reason, 'threadWriterBusy'); assert.equal(error.code, -32600)
  assert.match(error.message, /noutro cliente Codex/)
  assert.doesNotMatch(error.message, /00000000/)
  assert.doesNotMatch(codexRPCError('thread/resume', { message: 'token=private-secret' }).message, /private-secret/)
})
