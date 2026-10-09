import test from 'node:test'
import assert from 'node:assert/strict'
import { executeUIAction, parseUIAction } from './actions.mjs'

test('accepts only the closed UI action protocol', () => {
  assert.deepEqual(parseUIAction('{"action":"fill_credential","selector":"#password","field":"password"}'), {
    action:'fill_credential', caption:'', selector:'#password', field:'password',
  })
  assert.throws(() => parseUIAction('{"action":"javascript","value":"alert(1)"}'), /unsupported UI action/)
  assert.throws(() => parseUIAction('{"action":"navigate","url":"https://example.com","script":"x"'), SyntaxError)
})

test('navigation cannot leave the configured environment origin', async () => {
  const wc = { getURL: () => 'https://app.example.test/home', loadURL: async () => undefined }
  await assert.rejects(() => executeUIAction(wc, { action:'navigate', url:'https://evil.example.test/' }, { origin:'https://app.example.test', credentials:{}, wait:async () => undefined }), /leave the configured environment origin/)
})
