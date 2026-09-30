import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInternalChatGPTBrowser } from './internal-window.mjs'

test('internal browser reuses its owned window and keeps privileged preferences out', async () => {
  const browsers = new Map()
  const loads = []
  let options
  class FakeBrowserWindow {
    constructor(value) {
      options = value
      this.webContents = {
        getURL: () => loads.at(-1) || '',
        setUserAgent: () => {},
        setWindowOpenHandler: () => {},
        on: () => {},
      }
    }
    isDestroyed() { return false }
    loadURL(value) { loads.push(value); return Promise.resolve() }
    on() {}
    show() {}
    focus() {}
  }
  const open = createInternalChatGPTBrowser({
    BrowserWindow: FakeBrowserWindow, shell: { openExternal: async () => {} },
    browsers, trustedURL: (value) => new URL(value).href,
    isTrustedOrigin: (value) => new URL(value).origin === 'https://chatgpt.com',
    isHTTPS: (value) => new URL(value).protocol === 'https:',
    titleFor: () => 'Wharnex', securePreferences: (extra) => ({ sandbox: true, contextIsolation: true, nodeIntegration: false, ...extra }),
    partition: 'persist:chatgpt', userAgent: 'Wharnex test', icon: {},
    instance: 'test', homeURL: 'https://chatgpt.com/',
  })
  const owner = { id: 'window-1', window: { isDestroyed: () => false }, activeProject: '/project' }
  assert.deepEqual(open(owner, 'https://chatgpt.com/c/one'), { ok: true, reused: false })
  assert.deepEqual(open(owner, 'https://chatgpt.com/c/two'), { ok: true, reused: true })
  assert.deepEqual(loads, ['https://chatgpt.com/c/one', 'https://chatgpt.com/c/two'])
  assert.equal(browsers.size, 1)
  assert.equal(options.webPreferences.partition, 'persist:chatgpt')
  assert.equal(options.webPreferences.sandbox, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
})
