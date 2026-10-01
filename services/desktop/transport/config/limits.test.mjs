import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_CONTEXT_BYTES, MAX_PLAN_BYTES, MAX_EXECUTION_BUNDLE_BYTES,
  MAX_MARKDOWN_TRANSLATION_BYTES, MAX_MARKDOWN_TRANSLATION_RESULT_BYTES,
} from './index.mjs'

test('transport size limits keep their established ordering and caps', () => {
  assert.equal(MAX_CONTEXT_BYTES, 256 * 1024 * 1024)
  assert.equal(MAX_PLAN_BYTES, 2 * 1024 * 1024)
  assert.equal(MAX_EXECUTION_BUNDLE_BYTES, 16 * 1024 * 1024)
  assert.equal(MAX_MARKDOWN_TRANSLATION_BYTES, 4 * 1024 * 1024)
  assert.equal(MAX_MARKDOWN_TRANSLATION_RESULT_BYTES, 8 * 1024 * 1024)
})
