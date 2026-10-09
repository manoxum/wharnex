import { readDesktopIPCSource } from '../../../composition/ipc/source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('new ChatGPT views open the requested conversation as part of their first visible show', async () => {
  const source = await readDesktopIPCSource()
  const authViewRuntime = await readFile(new URL('../../../composition/session/auth-view/runtime.mjs', import.meta.url), 'utf8')
  const visibility = await readFile(new URL('./visibility.mjs', import.meta.url), 'utf8')
  const create = await readFile(new URL('../views/supervisor.mjs', import.meta.url), 'utf8')
  const entry = await readFile(new URL('../views/entry.mjs', import.meta.url), 'utf8')
  const load = await readFile(new URL('../views/navigation.mjs', import.meta.url), 'utf8')
  assert.match(source, /compose\(ctx, 'auth-views', createDesktopAuthViewRuntime, \{/)
  assert.match(authViewRuntime, /createChatGPTViewOperations\(\{/)
  assert.match(create, /createChatGPTViewEntry\(view, cacheKey, windowState\.id/)
  assert.match(entry, /loading: false/)
  assert.match(entry, /loadingSince: 0/)
  assert.doesNotMatch(create, /loadURL\(CHATGPT_URL/)

  const showStart = visibility.indexOf("ipcMain.handle('wharness:chatgpt:show'")
  const showEnd = visibility.indexOf("ipcMain.handle('wharness:chatgpt:hide'", showStart)
  const show = visibility.slice(showStart, showEnd)
  assert.match(source, /registerChatGPTSurfaceIPC\(\{/)
  assert.match(source, /homeURL: CHATGPT_URL/)
  assert.match(show, /const initialTarget = request\?\.url \? requireTrustedChatGPTURL\(request\.url\) : homeURL/)
  assert.match(show, /loadOwnedChatGPTURL\(request\?\.cacheKey, entry, initialTarget, 'initial-show'\)/)
  assert.match(show, /isTrustedChatGPTOrigin\(wc\.getURL\(\)\)/)
  assert.match(show, /waitForChatGPTSurfaceReady/)

  assert.match(load, /reason === 'initial-show'/)
  assert.match(load, /initial navigation stalled; retrying once/)
  assert.match(load, /'initial-show-retry'/)
})

test('navigation only observes affinity and a stable late observer performs definitive settlement', async () => {
  const source = await readDesktopIPCSource()
  const runtime = await readFile(new URL('../../../composition/session/view-health-runtime.mjs', import.meta.url), 'utf8')
  const navigation = await readFile(new URL('./navigation.mjs', import.meta.url), 'utf8')
  const create = await readFile(new URL('../views/supervisor.mjs', import.meta.url), 'utf8')
  const affinityRuntime = await readFile(new URL('../ownership/affinity-runtime.mjs', import.meta.url), 'utf8')
  assert.match(create, /observeChatGPTAffinityURL\(cacheKey, entry, url\); scheduleChatGPTAffinitySettlement\(cacheKey, entry\)/)
  const settleStart = affinityRuntime.indexOf('function scheduleChatGPTAffinitySettlement')
  const settle = affinityRuntime.slice(settleStart)
  const workflowRuntime = await readFile(new URL('../../../composition/session/workflow/runtime.mjs', import.meta.url), 'utf8')
  assert.match(source, /compose\(ctx, 'chat-workflow', createDesktopChatWorkflowRuntime, \{/)
  assert.match(workflowRuntime, /createDesktopChatViewHealthRuntime\(\{/)
  assert.match(runtime, /createChatGPTAffinityRuntime\(\{/)
  assert.match(settle, /waitForConcreteChatGPTConversation\(entry\.view\.webContents, 2_500\)/)
  assert.match(settle, /settleChatGPTAffinityAfterSubmit\(cacheKey, entry, stableURL\)/)

  const navigateStart = navigation.indexOf("ipcMain.handle('wharness:chatgpt:navigate'")
  const navigateEnd = navigation.indexOf("ipcMain.handle('wharness:chatgpt:confirm-affinity'", navigateStart)
  const navigate = navigation.slice(navigateStart, navigateEnd)
  assert.match(navigate, /shouldPreserveChatGPTAffinityNavigation\(entry\.affinity\)/)
  assert.match(navigate, /if \(!preservePendingConversation\) syncChatGPTAffinityURL/)
  assert.match(navigate, /!preservePendingConversation && unboundHomeIntent/)
  assert.match(navigate, /scheduleChatGPTAffinitySettlement\(key, entry\)/)
})
