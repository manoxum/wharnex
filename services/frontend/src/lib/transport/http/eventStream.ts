import type { HarnessEvent } from '../../../types'

// Opening a session's event stream replays a catch-up of everything the
// backend already holds for it before any live event arrives. On a long-lived
// session that is thousands of frames delivered as one burst.
//
// Treating each frame as its own React state update — and persisting the whole
// retained window from inside the `setEvents` updater, which React may re-run
// for every queued update on every render pass — made the cost quadratic in
// the size of that burst. A measured 3159-frame catch-up (4.7 MB) turned into
// thousands of 500-event serializations: the renderer's main thread never
// yielded, so nothing painted and no input was handled, and its heap passed
// the V8 limit in about 25 seconds, killing and restarting the window in a
// loop.
//
// This coalescer is the seam that keeps that from being reintroduced. It owns
// deduplication, the retained window, and the flush/persist cadence, so the
// caller only reacts to whole batches and never has to write from inside a
// React updater.

export const EVENT_FLUSH_INTERVAL_MS = 120
export const EVENT_PERSIST_INTERVAL_MS = 1_000
export const EVENT_WINDOW_LIMIT = 500
// A very long-lived stream would otherwise retain one id per event forever.
// Anything older than the retained window is deduplicated by the transcript.
export const EVENT_ID_MEMORY_LIMIT = 20_000

export type EventStreamTimers = {
  set: (callback: () => void, ms: number) => number
  clear: (handle: number) => void
}

export type EventStreamOptions = {
  /** The window already restored from local storage, oldest first. */
  restored?: HarnessEvent[]
  /** Called once per batch with the new frames and the resulting window. */
  onFlush: (batch: HarnessEvent[], window: HarnessEvent[]) => void
  /** Called on the debounced persistence cadence with the window to store. */
  onPersist: (window: HarnessEvent[]) => void
  /**
   * Answers whether this stream is still the live one. A timer that outlives
   * its stream must not write another chat's window.
   */
  isCurrent?: () => boolean
  flushIntervalMs?: number
  persistIntervalMs?: number
  windowLimit?: number
  timers?: EventStreamTimers
}

export type EventStreamCoalescer = {
  /** Accepts one decoded SSE frame. Returns false when it was a duplicate. */
  accept: (event: HarnessEvent) => boolean
  /** Runs any pending flush immediately. */
  flushPending: () => void
  /** Cancels pending timers without flushing. */
  dispose: () => void
  window: () => HarnessEvent[]
}

const defaultTimers: EventStreamTimers = {
  set: (callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number,
  clear: (handle) => globalThis.clearTimeout(handle),
}

export function createEventStreamCoalescer(options: EventStreamOptions): EventStreamCoalescer {
  const timers = options.timers || defaultTimers
  const flushInterval = options.flushIntervalMs ?? EVENT_FLUSH_INTERVAL_MS
  const persistInterval = options.persistIntervalMs ?? EVENT_PERSIST_INTERVAL_MS
  const limit = options.windowLimit ?? EVENT_WINDOW_LIMIT
  const isCurrent = options.isCurrent || (() => true)

  let windowEvents = (options.restored || []).slice(-limit)
  let seen = new Set(windowEvents.map((event) => event.id))
  let buffer: HarnessEvent[] = []
  let flushTimer = 0
  let persistTimer = 0

  const persist = () => {
    persistTimer = 0
    if (!isCurrent()) return
    options.onPersist(windowEvents)
  }

  const flush = () => {
    flushTimer = 0
    if (!isCurrent()) return
    const batch = buffer
    if (!batch.length) return
    buffer = []
    windowEvents = windowEvents.concat(batch).slice(-limit)
    options.onFlush(batch, windowEvents)
    if (!persistTimer) persistTimer = timers.set(persist, persistInterval)
  }

  return {
    accept(event) {
      if (!event?.id || seen.has(event.id)) return false
      if (seen.size > EVENT_ID_MEMORY_LIMIT) seen = new Set(windowEvents.map((item) => item.id))
      seen.add(event.id)
      buffer.push(event)
      if (!flushTimer) flushTimer = timers.set(flush, flushInterval)
      return true
    },
    flushPending() {
      if (flushTimer) { timers.clear(flushTimer); flushTimer = 0 }
      flush()
    },
    dispose() {
      if (flushTimer) { timers.clear(flushTimer); flushTimer = 0 }
      if (persistTimer) { timers.clear(persistTimer); persistTimer = 0 }
      buffer = []
    },
    window: () => windowEvents,
  }
}
