export { registerAgentMirrorStreamIPC } from './ipc.mjs'

const IDLE_FRAME_MS = 125
const INTERACTIVE_FRAME_MS = 66
const INTERACTIVE_WINDOW_MS = 2_000
const RECONCILE_MS = 500
const JPEG_QUALITY = 78
const SEED_EVENTS = ['did-navigate', 'did-navigate-in-page', 'did-finish-load']

// One live stream per agent view, shared by every pane that subscribes to it.
//
// The real agent views live in the browser host; a project pane that wants to
// follow one subscribes and receives a dedicated MessagePort. Frames are driven
// by the renderer's own paints (a frame subscription), not by polling, so a
// page that does not repaint costs nothing; paints are coalesced and encoded
// once for all subscribers at a bounded rate, higher right after the user's own
// input. Delivery is credit-based: a subscriber gets the next frame only after
// acknowledging the previous one, so a slow or hidden pane receives fewer
// frames instead of a backlog. Frames are pixels for the local user only: never
// persisted, logged or interpreted.
export function createAgentMirrorStreams({
  MessageChannelMain, desktopWindows,
  setInterval: schedule = globalThis.setInterval, clearInterval: unschedule = globalThis.clearInterval,
  setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout,
  now = Date.now,
}) {
  const streams = new Map()
  let timer

  const windowShowing = (state) => {
    const win = state?.window
    return Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized())
  }

  const canReceive = (subscriber) => subscriber.ready && subscriber.stillAuthorized() && windowShowing(desktopWindows.get(subscriber.windowId))

  function deliver(stream, subscriber) {
    const frame = stream.encoded
    if (!frame || !canReceive(subscriber) || subscriber.sentSeq >= frame.seq) return
    subscriber.ready = false
    subscriber.sentSeq = frame.seq
    subscriber.port.postMessage({ width: frame.width, height: frame.height, data: frame.data })
  }

  function encode(stream) {
    if (!stream.capturing || ![...stream.subscribers].some(canReceive)) return
    const image = stream.latest
    stream.latest = undefined
    if (!image || image.isEmpty()) return
    const { width, height } = image.getSize()
    stream.encoded = { seq: ++stream.sequence, width, height, data: image.toJPEG(JPEG_QUALITY) }
    stream.lastEncodedAt = now()
    stream.needsSeed = false
    for (const subscriber of stream.subscribers) deliver(stream, subscriber)
  }

  function queue(stream, flush = false) {
    if (stream.timer || !stream.latest || !stream.capturing || ![...stream.subscribers].some(canReceive)) return
    const lastInput = Number(stream.entry.mirrorInputAt)
    const interactive = Number.isFinite(lastInput) && now() - lastInput < INTERACTIVE_WINDOW_MS
    const wait = Math.max(0, stream.lastEncodedAt + (interactive ? INTERACTIVE_FRAME_MS : IDLE_FRAME_MS) - now())
    if (flush && wait === 0) { encode(stream); return }
    stream.timer = later(() => { stream.timer = undefined; encode(stream) }, wait)
  }

  // A page that is not repainting produces no frame, so a new subscriber, or a
  // page that just navigated, is seeded with a single capture. A parked view
  // whose surface was dropped is repainted, which resumes its frames.
  async function seed(stream) {
    if (stream.seeding) return
    stream.seeding = true
    const revision = stream.revision
    try {
      const image = await stream.wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (image.isEmpty()) throw new Error('empty frame')
      if (streams.get(stream.entry) !== stream || !stream.capturing || revision !== stream.revision) return
      stream.needsSeed = false
      if (!stream.latest) stream.latest = image
      queue(stream)
    } catch {
      if (streams.get(stream.entry) === stream && stream.capturing && !stream.wc.isDestroyed()) stream.entry.view.paint?.()
    } finally {
      stream.seeding = false
    }
  }

  function startCapture(stream) {
    if (stream.capturing || stream.wc.isDestroyed()) return
    stream.capturing = true
    stream.wc.beginFrameSubscription(false, stream.onFrame)
    stream.needsSeed = true
  }

  function stopCapture(stream) {
    if (!stream.capturing) return
    stream.capturing = false
    stream.revision++
    stream.latest = undefined
    stream.encoded = undefined
    cancel(stream.timer)
    stream.timer = undefined
    if (!stream.wc.isDestroyed()) try { stream.wc.endFrameSubscription() } catch { /* renderer is closing */ }
  }

  function streamFor(entry) {
    const existing = streams.get(entry)
    if (existing) return existing
    const wc = entry.view.webContents
    const stream = { entry, wc, subscribers: new Set(), latest: undefined, encoded: undefined, lastEncodedAt: -Infinity, revision: 0, sequence: 0, timer: undefined, needsSeed: true, seeding: false, capturing: false }
    stream.onFrame = (image) => { stream.latest = image; queue(stream) }
    stream.onNavigate = () => { stream.revision++; stream.needsSeed = true; stream.latest = undefined; stream.encoded = undefined }
    stream.onDestroyed = () => { for (const subscriber of [...stream.subscribers]) unsubscribe(stream, subscriber) }
    for (const event of SEED_EVENTS) wc.on(event, stream.onNavigate)
    wc.once('destroyed', stream.onDestroyed)
    streams.set(entry, stream)
    return stream
  }

  function unsubscribe(stream, subscriber) {
    if (!stream.subscribers.delete(subscriber)) return
    try { subscriber.port.close() } catch { /* already closed */ }
    if (stream.subscribers.size) return
    stopCapture(stream)
    streams.delete(stream.entry)
    if (!stream.wc.isDestroyed()) {
      for (const event of SEED_EVENTS) stream.wc.removeListener(event, stream.onNavigate)
      stream.wc.removeListener('destroyed', stream.onDestroyed)
    }
  }

  // Capture runs only while some subscriber's window is actually showing.
  function reconcileStream(stream) {
    for (const subscriber of [...stream.subscribers]) {
      if (stream.wc.isDestroyed() || !desktopWindows.has(subscriber.windowId) || !subscriber.stillAuthorized()) unsubscribe(stream, subscriber)
    }
    if (streams.get(stream.entry) !== stream) return
    const showing = [...stream.subscribers].some((subscriber) => windowShowing(desktopWindows.get(subscriber.windowId)))
    if (!showing) { stopCapture(stream); return }
    startCapture(stream)
    if (stream.latest) queue(stream)
    if (stream.needsSeed) void seed(stream)
    for (const subscriber of stream.subscribers) deliver(stream, subscriber)
  }

  // Opens a subscription for one trusted window and returns the renderer's end
  // of its dedicated port. `stillAuthorized` is re-checked while it lives.
  function subscribe(entry, windowState, stillAuthorized) {
    if (!entry?.view?.webContents || entry.view.webContents.isDestroyed()) throw new Error('Instância do navegador indisponível')
    const stream = streamFor(entry)
    const { port1, port2 } = new MessageChannelMain()
    const subscriber = { port: port1, windowId: windowState.id, stillAuthorized, ready: true, sentSeq: 0 }
    port1.on('message', (event) => {
      if (event?.data !== 'ready') return
      subscriber.ready = true
      if (stream.latest) queue(stream, true)
      else deliver(stream, subscriber)
    })
    port1.on('close', () => unsubscribe(stream, subscriber))
    port1.start()
    stream.subscribers.add(subscriber)
    reconcileStream(stream)
    return port2
  }

  function reconcile() {
    for (const stream of [...streams.values()]) reconcileStream(stream)
  }

  function start() {
    if (!timer) timer = schedule(reconcile, RECONCILE_MS)
  }

  function stop() {
    if (timer) unschedule(timer)
    timer = undefined
    for (const stream of [...streams.values()]) for (const subscriber of [...stream.subscribers]) unsubscribe(stream, subscriber)
  }

  return { start, stop, reconcile, subscribe, streams }
}
