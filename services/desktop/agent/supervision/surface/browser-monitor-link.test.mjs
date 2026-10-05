import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserMonitorLink } from './browser-monitor-link.mjs'

function fixture() {
  const events = []
  const handlers = {}
  class View {
    addChildView() {}
    removeChildView() {}
    setBounds(bounds) { this.bounds = bounds }
    getBounds() { return this.bounds || { x: 0, y: 0, width: 0, height: 0 } }
  }
  class WebContentsView {
    constructor({ webPreferences }) {
      events.push(webPreferences.partition)
      this.webContents = {
        isDestroyed: () => false, once: () => undefined,
        on: (name, handler) => { handlers[name] = handler },
        setUserAgent: () => undefined, setWindowOpenHandler: (handler) => { handlers.open = handler },
        loadURL: async (url) => { events.push(`load:${url}`) },
        getZoomFactor: () => 1, capturePage: async () => undefined,
        close: () => { events.push('close') },
      }
    }
    setBackgroundColor() {}
    setVisible() {}
    getVisible() { return true }
    setBounds() {}
  }
  const monitor = { id: 'browser-monitor', window: { isDestroyed: () => false,
    contentView: { addChildView: () => events.push('present'), removeChildView: () => events.push('release') } } }
  const other = { ...monitor, id: 'project' }
  const link = createBrowserMonitorLink({ WebContentsView, securePreferences: (input) => input,
    CHATGPT_PARTITION: 'persist:chatgpt', CHATGPT_USER_AGENT: 'test', browserHost: { View, attach() {}, detach() {} },
    releaseAgent: () => events.push('release-agent'),
    requireMonitor: (state) => { if (state.id !== 'browser-monitor') throw new Error('monitor only') },
    normalizeMonitorBounds: (bounds) => { if (bounds.width < 80) throw new Error('bounds'); return bounds },
  })
  return { link, monitor, other, events, handlers }
}

const bounds = { x: 10, y: 10, width: 600, height: 400 }

test('a human-selected chat uses one isolated ephemeral view and closes on switch', () => {
  const { link, monitor, events, handlers } = fixture()
  const first = 'https://chatgpt.com/c/first-chat'
  link.presentBrowserLinkInMonitor(first, bounds, monitor)
  link.presentBrowserLinkInMonitor(first, bounds, monitor)
  assert.equal(events.filter((value) => value === `load:${first}`).length, 1)
  assert.equal(events.filter((value) => value === 'persist:chatgpt').length, 1)
  assert.deepEqual(handlers.open({ url: 'https://example.com' }), { action: 'deny' })
  let blocked = false
  handlers['will-navigate']({ preventDefault: () => { blocked = true } }, 'https://example.com')
  assert.equal(blocked, true)
  link.presentBrowserLinkInMonitor('https://chatgpt.com/c/second-chat', bounds, monitor)
  assert.equal(events.filter((value) => value === 'close').length, 1)
  assert.deepEqual(link.closeBrowserLinkInMonitor(monitor, first), { ok: true, closed: false })
  assert.deepEqual(link.closeBrowserLinkInMonitor(monitor), { ok: true, closed: true })
  assert.equal(events.filter((value) => value === 'close').length, 2)
})

test('rejects untrusted callers and non-conversation URLs before creating a view', () => {
  const { link, monitor, other, events } = fixture()
  assert.throws(() => link.presentBrowserLinkInMonitor('https://chatgpt.com/c/good', bounds, other), /monitor only/)
  assert.throws(() => link.presentBrowserLinkInMonitor('https://evil.test/c/bad', bounds, monitor), /inválido/)
  assert.throws(() => link.presentBrowserLinkInMonitor('https://chatgpt.com/c/good?x=1', bounds, monitor), /inválido/)
  assert.equal(events.length, 0)
})
