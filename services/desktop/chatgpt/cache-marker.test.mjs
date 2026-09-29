import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createChatGPTCacheMarker } from './cache-marker.mjs'

test('the ChatGPT asset cache marker changes only with the Chromium version', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wharnex-chatgpt-cache-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const currentVersion = createChatGPTCacheMarker({ userDataPath: () => dir, chromiumVersion: '152.0' })
  const olderVersion = createChatGPTCacheMarker({ userDataPath: () => dir, chromiumVersion: '151.0' })
  assert.equal(currentVersion.current(), false)
  currentVersion.write()
  assert.equal(currentVersion.current(), true)
  assert.equal(olderVersion.current(), false)
  const stored = JSON.parse(await readFile(path.join(dir, 'wharness-chatgpt-cache-marker.json'), 'utf8'))
  assert.deepEqual(stored, { chromiumVersion: '152.0' })
})

test('Desktop clears the ChatGPT cache only after the version marker differs', async () => {
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8')
  const start = main.indexOf('app.whenReady().then(async () => {')
  assert.notEqual(start, -1)
  const boot = main.slice(start, main.indexOf('\n  const layout = loadWindowLayout()', start))
  assert.match(main, /const chatGPTCacheMarkerCurrent = chatGPTCacheMarker\.current/)
  assert.match(boot, /if \(!chatGPTCacheMarkerCurrent\(\)\) \{/)
  const guardStart = boot.indexOf('if (!chatGPTCacheMarkerCurrent())')
  const guard = boot.slice(guardStart, boot.indexOf('\n  }', guardStart))
  assert.match(guard, /await chatSession\.clearCache\(\)/)
  assert.match(guard, /writeChatGPTCacheMarker\(\)/)
})
