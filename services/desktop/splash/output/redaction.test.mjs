import test from 'node:test'
import assert from 'node:assert/strict'
import { createOutputRedactor } from './redaction.mjs'

test('redacts credentials and control sequences without hiding useful progress', () => {
  const redact = createOutputRedactor({ MY_TOKEN: 'private-value' })
  for (const value of ['API_KEY="sensitive"', 'Authorization: Bearer sensitive', 'Cookie: session=sensitive other=sensitive', 'https://user:sensitive@example.com', 'private-value', 'sk-abcdefgh12345678']) {
    assert.doesNotMatch(redact(value), /sensitive|private-value|abcdefgh12345678/)
  }
  assert.equal(redact('\x1b[32mBuilding frontend\x1b[0m\x00'), 'Building frontend')
  assert.equal(redact('x'.repeat(10000)).length, 2000)
})

test('does not expose multiline private keys', () => {
  const redact = createOutputRedactor()
  assert.equal(redact('-----BEGIN PRIVATE KEY-----'), '[REDACTED]')
  assert.equal(redact('private key body'), '[REDACTED]')
  assert.equal(redact('-----END PRIVATE KEY-----'), '[REDACTED]')
  assert.equal(redact('Finished'), 'Finished')
})
