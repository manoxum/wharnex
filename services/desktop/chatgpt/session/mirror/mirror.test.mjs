import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentMirrorStreams, registerAgentMirrorStreamIPC } from './frames.mjs'
import { dispatchMirrorInput, sanitizeMirrorInput } from './input.mjs'

const image = (label) => ({ isEmpty: () => false, getSize: () => ({ width: 900, height: 700 }), toJPEG: () => Buffer.from(label) })

function window({ visible = true, minimized = false } = {}) {
  const state = { visible, minimized }
  return { state, isDestroyed: () => false, isVisible: () => state.visible, isMinimized: () => state.minimized }
}

// A view whose renderer paints only when the test says so.
function surface(seeds, calls = []) {
  let index = 0
  const listeners = new Map()
  const wc = {
    isDestroyed: () => false,
    paintFrame: undefined,
    capturePage: async (_rect, options) => {
      calls.push(`capture:${options.stayHidden}`)
      const frame = seeds[Math.min(index++, seeds.length - 1)]
      if (frame instanceof Error) throw frame
      return image(frame)
    },
    beginFrameSubscription: (onlyDirty, callback) => { calls.push(`subscribe:${onlyDirty}`); wc.paintFrame = callback },
    endFrameSubscription: () => { calls.push('unsubscribe'); wc.paintFrame = undefined },
    on: (event, callback) => listeners.set(event, callback),
    once: (event, callback) => listeners.set(event, callback),
    removeListener: (event) => listeners.delete(event),
    emit: (event) => listeners.get(event)?.(),
  }
  return { isVisible: () => true, paint: () => calls.push('paint'), webContents: wc }
}

class FakePort {
  constructor() { this.sent = []; this.handlers = {}; this.closed = false }
  on(event, handler) { this.handlers[event] = handler }
  start() {}
  postMessage(message) { this.sent.push(message) }
  close() { if (this.closed) return; this.closed = true; this.handlers.close?.() }
  ready() { this.handlers.message?.({ data: 'ready' }) }
}
class MessageChannelMain { constructor() { this.port1 = new FakePort(); this.port2 = { renderer: true } } }

function clock() {
  let time = 0
  const timers = []
  return {
    now: () => time,
    setTimeout: (callback, wait) => { const timer = { callback, at: time + wait }; timers.push(timer); return timer },
    clearTimeout: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1) },
    advance(ms) {
      time += ms
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > time) continue
        timers.splice(timers.indexOf(timer), 1)
        timer.callback()
      }
    },
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))
const frames = (port) => port.sent.map((frame) => String(frame.data))

function fixture(seeds = ['seed']) {
  const calls = []
  const time = clock()
  const project = { id: 'project', window: window() }
  const desktopWindows = new Map([['project', project]])
  const entry = { view: surface(seeds, calls) }
  const streams = createAgentMirrorStreams({ MessageChannelMain, desktopWindows, ...time })
  const open = (allowed = () => true) => {
    streams.subscribe(entry, project, allowed)
    return [...streams.streams.get(entry).subscribers].at(-1).port
  }
  return { streams, entry, project, desktopWindows, calls, time, open }
}

test('a subscriber is seeded once, then fed only by paints, one frame per acknowledgement', async () => {
  const { entry, calls, time, open } = fixture()
  const port = open()
  await settle(); time.advance(0)
  assert.deepEqual(calls, ['subscribe:false', 'capture:true'])
  assert.deepEqual(frames(port), ['seed'])
  // Paints while the frame is unacknowledged are coalesced and held back.
  const paint = entry.view.webContents.paintFrame
  paint(image('p1')); paint(image('p2'))
  time.advance(200)
  assert.deepEqual(frames(port), ['seed'])
  port.ready()
  assert.deepEqual(frames(port), ['seed', 'p2'])
  // A static page sends nothing, even when acknowledged.
  port.ready(); time.advance(2_000)
  assert.equal(port.sent.length, 2)
  assert.equal(calls.filter((call) => call.startsWith('capture')).length, 1)
})

test('paints are encoded at a bounded rate that rises after the user input', async () => {
  const { entry, time, open } = fixture()
  const port = open()
  await settle(); time.advance(0); port.ready()
  const paint = entry.view.webContents.paintFrame
  paint(image('idle'))
  time.advance(100)
  assert.equal(port.sent.length, 1)
  time.advance(25)
  assert.deepEqual(frames(port), ['seed', 'idle'])
  port.ready()
  entry.mirrorInputAt = time.now()
  paint(image('typing'))
  time.advance(66)
  assert.deepEqual(frames(port), ['seed', 'idle', 'typing'])
})

test('subscribers share one stream, and capture stops with the last one or while no window shows it', async () => {
  const { streams, entry, project, calls, time, open } = fixture(['seed', 'again'])
  const first = open()
  const second = open()
  await settle(); time.advance(0)
  assert.deepEqual(frames(first), ['seed'])
  assert.deepEqual(frames(second), ['seed'])
  assert.equal(calls.filter((call) => call === 'subscribe:false').length, 1)
  project.window.state.minimized = true
  streams.reconcile()
  assert.equal(calls.at(-1), 'unsubscribe')
  project.window.state.minimized = false
  streams.reconcile(); await settle(); time.advance(0)
  assert.equal(calls.filter((call) => call === 'subscribe:false').length, 2)
  first.close()
  assert.equal(entry.view.webContents.paintFrame !== undefined, true)
  second.close()
  assert.equal(calls.at(-1), 'unsubscribe')
  assert.equal(streams.streams.size, 0)
})

test('a revoked subscription is closed and a dropped surface is repainted', async () => {
  const { streams, entry, calls, time, open } = fixture([new Error('UnknownVizError'), 'seed'])
  let allowed = true
  const port = open(() => allowed)
  await settle()
  assert.ok(calls.includes('paint'))
  streams.reconcile(); await settle(); time.advance(0)
  assert.deepEqual(frames(port), ['seed'])
  entry.view.webContents.emit('did-navigate')
  allowed = false
  streams.reconcile()
  assert.equal(port.closed, true)
  assert.equal(streams.streams.size, 0)
})

test('only the owning window may subscribe to a Supervisor or surfaced Worker stream', () => {
  const handlers = {}
  const replies = []
  const ipcMain = { on: (channel, handler) => { handlers[channel] = handler } }
  const project = { id: 'project', activeChatGPTKey: 'chat-1', activeAgentInteractionId: 'worker-1' }
  const other = { id: 'other', activeChatGPTKey: 'chat-1' }
  const supervisor = { ownerWindowId: 'project', view: surface(['s']) }
  const worker = { slotId: 'worker-1', interactionWindowId: 'project', view: surface(['w']) }
  const subscribed = []
  registerAgentMirrorStreamIPC({
    ipcMain, trustedSender: (event) => event.state, sanitizeChatCacheKey: (value) => String(value || ''),
    chatgptViews: new Map([['chat-1', supervisor]]), chatGPTWorkerEntries: [worker],
    mirrorStreams: { subscribe: (entry, state) => { subscribed.push([entry, state.id]); return { port: true } } },
  })
  const event = (state) => ({ state, sender: { postMessage: (channel, reply, ports) => replies.push([reply.ok, ports.length]) } })
  handlers['wharness:chatgpt:mirror-subscribe'](event(project), { cacheKey: 'chat-1', requestId: 'r1' })
  handlers['wharness:chatgpt:mirror-subscribe'](event(other), { cacheKey: 'chat-1', requestId: 'r2' })
  handlers['wharness:agents:mirror-subscribe'](event(project), { agentId: 'worker-1', requestId: 'r3' })
  handlers['wharness:agents:mirror-subscribe'](event(other), { agentId: 'worker-1', requestId: 'r4' })
  assert.deepEqual(replies, [[true, 1], [false, 0], [true, 1], [false, 0]])
  assert.deepEqual(subscribed.map(([entry, id]) => [entry === supervisor ? 'supervisor' : 'worker', id]), [['supervisor', 'project'], ['worker', 'project']])
})

test('mirror input is a closed vocabulary with page-derived text', () => {
  assert.deepEqual(sanitizeMirrorInput({ type: 'mousePressed', nx: 2, ny: -1, button: 'left', clickCount: 9, modifiers: 99 }), {
    type: 'mousePressed', modifiers: 15, button: 'left', nx: 1, ny: 0, buttons: 0, clickCount: 3, deltaX: 0, deltaY: 0,
  })
  assert.throws(() => sanitizeMirrorInput({ type: 'navigate', url: 'https://example.com' }), /inválido/)
  assert.throws(() => sanitizeMirrorInput({ type: 'keyDown', key: 'a', code: 'Key-A' }), /inválida/)
})

test('mirror input reaches the view over the debugger in page coordinates', async () => {
  const commands = []
  let attached = false
  const wc = {
    isDestroyed: () => false, getZoomFactor: () => 0.5,
    debugger: {
      isAttached: () => attached, attach: () => { attached = true }, detach: () => { attached = false },
      sendCommand: async (method, params) => { commands.push([method, params]) },
    },
  }
  const entry = { view: { webContents: wc, native: { getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }) } } }
  await dispatchMirrorInput(entry, { type: 'mousePressed', nx: 0.5, ny: 0.25, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 })
  await dispatchMirrorInput(entry, { type: 'keyDown', key: 'v', code: 'KeyV', keyCode: 86, modifiers: 2 })
  await dispatchMirrorInput(entry, { type: 'keyDown', key: 'é', code: '', keyCode: 0, modifiers: 0 })
  assert.equal(attached, true)
  assert.deepEqual(commands[1], ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 400, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 }])
  assert.deepEqual(commands[3][1].commands, ['paste'])
  assert.equal(commands[3][1].type, 'rawKeyDown')
  assert.equal(commands[3][1].text, undefined)
  assert.deepEqual([commands[5][1].type, commands[5][1].text], ['keyDown', 'é'])
})
