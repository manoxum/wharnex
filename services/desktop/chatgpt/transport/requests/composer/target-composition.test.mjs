import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('a visible ChatGPT page performs one bounded composer reload before requiring human attention', async () => {
  const [main, target] = await Promise.all([
    readFile(new URL('../../../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./target.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(main, /createChatGPTComposerTarget\(\{/)
  assert.match(target, /for \(let attempt = 0; attempt < 20; attempt \+= 1\)/)
  assert.match(target, /await wait\(250\)/)
  assert.match(target, /let ready = await composerReady\(\)/)
  assert.match(target, /wc\.reload\(\)/)
  assert.match(target, /await waitForChatGPTSurfaceReady\(key, entry\)/)
  assert.match(target, /await assertNoHumanGate\('health-after-composer-reload'\)/)
  assert.match(target, /ready = await composerReady\(\)/)
  assert.ok(target.indexOf('wc.reload()') < target.indexOf("setChatGPTHumanAction(key, 'surface'"))
  assert.match(target, /setChatGPTHumanAction\(key, 'surface'/)
  assert.match(target, /throw new Error\(chatGPTHumanActionMessage\('surface'\)\)/)
})

test('DOM composer calls retry transient evaluation and retain the failing stage', async () => {
  const [main, target] = await Promise.all([
    readFile(new URL('../../../../main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./target.mjs', import.meta.url), 'utf8'),
  ])
  const helperStart = main.indexOf('async function executeChatGPTDOMScript(')
  const helperEnd = main.indexOf('\nconst { targetChatGPTComposer } = createChatGPTComposerTarget({', helperStart)
  const helper = main.slice(helperStart, helperEnd)
  assert.notEqual(helperStart, -1)
  assert.match(helper, /attempt <= 3/)
  assert.match(helper, /await waitForChatGPTSurfaceReady/)
  assert.match(helper, /\[chatgpt-dom\] stage=/)
  assert.match(target, /executeChatGPTDOMScript\(key, entry, stage, chatGPTHumanActionScript\(\)\)/)
  assert.match(target, /await assertNoHumanGate\('health'\)/)
  assert.match(target, /executeChatGPTDOMScript\(key, entry, 'composer-ready'/)
})
