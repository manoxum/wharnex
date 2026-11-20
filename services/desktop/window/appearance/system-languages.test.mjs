import test from 'node:test'
import assert from 'node:assert/strict'
import { systemLanguages } from './system-languages.mjs'
test('reads operating system language order and keeps locale metadata bounded', () => {
  assert.deepEqual(systemLanguages({ getPreferredSystemLanguages: () => ['pt-AO', 'en-GB', 'pt-AO', 'ar', 'not a locale', '/secret', null] }), ['pt-AO', 'en-GB', 'ar'])
  assert.equal(systemLanguages({ getPreferredSystemLanguages: () => Array.from({ length: 30 }, (_, i) => `en-${String(i).padStart(2, '0')}`) }).length, 8)
})
test('falls back to the application locale on older hosts and tolerates unavailable locale APIs', () => {
  assert.deepEqual(systemLanguages({ getLocale: () => 'fr-CA' }), ['fr-CA'])
  assert.deepEqual(systemLanguages({ getPreferredSystemLanguages: () => [], getLocale: () => 'en-US' }), ['en-US'])
  assert.deepEqual(systemLanguages({ getPreferredSystemLanguages: () => { throw Error('unavailable') } }), [])
  assert.deepEqual(systemLanguages({}), [])
})
