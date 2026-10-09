import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentMirrorStreams } from './frames.mjs'

function fixture() {
  const ports = [], timers = new Map(), events = new Map()
  let time = 0, encodes = 0, captures = 0, paint, visible = true
  const frame = (label) => ({
    isEmpty: () => false, getSize: () => ({ width: 900, height: 700 }),
    toJPEG: () => { encodes++; return Buffer.from(label) },
  })
  class MessageChannelMain {
    constructor() {
      const handlers = {}, sent = []
      this.port1 = {
        on: (event, callback) => { handlers[event] = callback },
        start() {}, close: () => handlers.close?.(),
        postMessage: (message) => sent.push(String(message.data)),
        ready: () => handlers.message({ data: 'ready' }), sent,
      }
      this.port2 = {}
      ports.push(this.port1)
    }
  }
  const wc = {
    isDestroyed: () => false,
    beginFrameSubscription: (_dirty, callback) => { paint = callback },
    endFrameSubscription: () => { paint = undefined },
    capturePage: async () => { captures++; return frame(captures === 1 ? 'seed' : `seed-${captures}`) },
    on: (event, callback) => events.set(event, callback),
    once: (event, callback) => events.set(event, callback),
    removeListener: (event) => events.delete(event),
  }
  const entry = { view: { webContents: wc } }
  const project = { id: 'project', window: {
    isDestroyed: () => false, isVisible: () => visible, isMinimized: () => false,
  } }
  const streams = createAgentMirrorStreams({
    MessageChannelMain, desktopWindows: new Map([['project', project]]), now: () => time,
    setTimeout: (callback, ms) => { const token = {}; timers.set(token, { callback, at: time + ms }); return token },
    clearTimeout: (token) => timers.delete(token),
  })
  const advance = (ms = 125) => {
    time += ms
    for (const [token, timer] of [...timers]) if (timer.at <= time) {
      timers.delete(token); timer.callback()
    }
  }
  const open = async (authorized = () => true) => {
    streams.subscribe(entry, project, authorized)
    await new Promise((resolve) => setImmediate(resolve))
    advance(0)
    return ports.at(-1)
  }
  return { streams, entry, open, advance, frame, paint: (label) => paint(frame(label)),
    counts: () => ({ encodes, captures }), hide: () => { visible = false },
    show: () => { visible = true }, navigate: () => events.get('did-navigate')(),
  }
}

test('100 paints without credit perform no JPEG work; acknowledgement draws only the latest', async () => {
  const f = fixture(), port = await f.open()
  for (let i = 0; i < 100; i++) { f.paint(`paint-${i}`); f.advance() }
  assert.equal(f.counts().encodes, 1, 'an unacknowledged pane must not consume CPU encoding unseen frames')
  assert.deepEqual(port.sent, ['seed'])
  port.ready(); f.advance()
  assert.deepEqual(port.sent, ['seed', 'paint-99'])
  assert.equal(f.counts().encodes, 2)
  f.streams.stop()
})

test('a new subscriber reuses the encoded seed while navigation requires a fresh capture', async () => {
  const f = fixture()
  await f.open()
  const second = await f.open()
  assert.deepEqual(second.sent, ['seed'])
  assert.deepEqual(f.counts(), { encodes: 1, captures: 1 })
  f.navigate(); f.streams.reconcile()
  await new Promise((resolve) => setImmediate(resolve))
  second.ready(); f.advance()
  assert.equal(f.counts().captures, 2)
  assert.deepEqual(second.sent, ['seed', 'seed-2'])
  f.streams.stop()
})

test('an acknowledgement while hidden or revoked must not encode or deliver a pending frame', async () => {
  const f = fixture()
  let allowed = true
  const port = await f.open(() => allowed)
  f.paint('pending'); f.hide(); port.ready(); f.advance()
  assert.equal(f.counts().encodes, 1)
  f.show(); allowed = false; port.ready(); f.advance()
  assert.deepEqual(port.sent, ['seed'])
  assert.equal(f.counts().encodes, 1)
  f.streams.stop()
})

test('one ready subscriber advances the shared encoding without accumulating frames for a slow pane', async () => {
  const f = fixture(), slow = await f.open(), fast = await f.open()
  for (let i = 0; i < 5; i++) { fast.ready(); f.paint(`paint-${i}`); f.advance() }
  assert.deepEqual(slow.sent, ['seed'])
  assert.equal(f.counts().encodes, 6)
  slow.ready(); f.advance()
  assert.deepEqual(slow.sent, ['seed', 'paint-4'])
  f.streams.stop()
})


test('capture suspension releases cached frames and resuming delivers a fresh monotonic frame', async () => {
  const f = fixture(), port = await f.open()
  f.hide(); f.streams.reconcile()
  const stream = f.streams.streams.get(f.entry)
  assert.equal(stream.encoded, undefined)
  assert.equal(stream.latest, undefined)
  port.ready(); f.show(); f.streams.reconcile()
  await new Promise((resolve) => setImmediate(resolve))
  f.advance()
  assert.deepEqual(port.sent, ['seed', 'seed-2'])
  f.streams.stop()
})

test('an uncoded navigation seed is captured once while all subscribers lack credit', async () => {
  const f = fixture(), port = await f.open()
  f.navigate(); f.streams.reconcile()
  await new Promise((resolve) => setImmediate(resolve))
  for (let i = 0; i < 10; i++) { f.streams.reconcile(); f.advance() }
  assert.deepEqual(f.counts(), { encodes: 1, captures: 2 })
  port.ready(); f.advance()
  assert.deepEqual(port.sent, ['seed', 'seed-2'])
  f.streams.stop()
})

test('a capture completed after navigation cannot repopulate the invalidated cache', async () => {
  const f = fixture(), port = await f.open()
  let finish
  const wc = f.entry.view.webContents
  const capture = wc.capturePage
  wc.capturePage = () => new Promise((resolve) => { finish = resolve })
  f.navigate(); f.streams.reconcile()
  f.navigate()
  finish(f.frame('obsolete'))
  await new Promise((resolve) => setImmediate(resolve))
  port.ready(); f.advance()
  assert.deepEqual(port.sent, ['seed'])
  wc.capturePage = capture
  f.streams.reconcile()
  await new Promise((resolve) => setImmediate(resolve))
  f.advance()
  assert.deepEqual(port.sent, ['seed', 'seed-2'])
  f.streams.stop()
})
