import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readDesktopCompositionSource } from '../../entry/source.mjs'

test('auth view keeps late worker and bundle dependencies behind the lazy view factory', async () => {
  const [main, runtime] = await Promise.all([
    readDesktopCompositionSource(),
    readFile(new URL('./runtime.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(main, /getHideChatAgentInteractionEntry: \(\) => ctx\.hideChatAgentInteractionEntry/)
  assert.match(main, /getDownloadPoller: \(\) => ctx\.pollExpectedChatGPTDownloadKey/)
  assert.match(main, /getHideChatGPTSidebar: \(\) => ctx\.hideChatGPTSidebar/)
  const lazyFactory = runtime.slice(runtime.indexOf('function chatGPTViewLifecycle()'))
  assert.match(lazyFactory, /if \(!chatGPTViewOperations\) chatGPTViewOperations = createChatGPTViewOperations\(\{/)
  assert.match(lazyFactory, /hideChatAgentInteractionEntry: \(\.\.\.args\) => deps\.getHideChatAgentInteractionEntry\(\)\(\.\.\.args\)/)
  assert.match(lazyFactory, /pollExpectedChatGPTDownloadKey: \(\.\.\.args\) => deps\.getDownloadPoller\(\)\(\.\.\.args\)/)
  assert.match(lazyFactory, /hideChatGPTSidebar: \(\.\.\.args\) => deps\.getHideChatGPTSidebar\(\)\(\.\.\.args\)/)
})
