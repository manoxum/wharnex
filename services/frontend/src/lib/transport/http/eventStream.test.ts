import { describe, expect, it } from 'vitest'
import { createEventStreamCoalescer, EVENT_WINDOW_LIMIT } from './eventStream'
import type { HarnessEvent } from '../../../types'

function event(index: number, type = 'command.output'): HarnessEvent {
  return { id: `evt-${index}`, session_id: 'ses-1', type, timestamp: '2026-09-19T05:00:00Z', data: { text: 'line' } }
}

// A controllable clock: the coalescer must never depend on a real timer, so a
// test can prove exactly how many flushes and persists a burst produces.
function fakeTimers() {
  const queued = new Map<number, () => void>()
  let next = 1
  return {
    timers: {
      set: (callback: () => void) => { const handle = next++; queued.set(handle, callback); return handle },
      clear: (handle: number) => { queued.delete(handle) },
    },
    run() {
      // Running a callback may schedule the next one (flush schedules persist).
      for (let guard = 0; guard < 10 && queued.size; guard++) {
        const pending = [...queued.entries()]
        queued.clear()
        for (const [, callback] of pending) callback()
      }
    },
    pending: () => queued.size,
  }
}

describe('event stream coalescer', () => {
  // The defect this guards: the SSE catch-up of a long-lived session arrives as
  // one burst of thousands of frames. Handling each frame as its own state
  // update - and persisting the whole retained window from inside the React
  // updater, which React may replay per queued update per render pass - made
  // the work quadratic in the burst, pinned the renderer's main thread so it
  // could neither paint nor accept input, and grew its heap past the V8 limit
  // in about 25 seconds, crash-looping the window.
  it('turns a catch-up burst into one flush and one persist', () => {
    const clock = fakeTimers()
    const flushes: number[] = []
    let persists = 0
    const coalescer = createEventStreamCoalescer({
      timers: clock.timers,
      onFlush: (batch) => flushes.push(batch.length),
      onPersist: () => { persists += 1 },
    })

    for (let index = 0; index < 3159; index++) coalescer.accept(event(index))
    expect(flushes).toEqual([])
    expect(persists).toBe(0)

    clock.run()

    expect(flushes).toEqual([3159])
    expect(persists).toBe(1)
    expect(coalescer.window()).toHaveLength(EVENT_WINDOW_LIMIT)
  })

  it('keeps the newest events when the burst exceeds the retained window', () => {
    const clock = fakeTimers()
    const coalescer = createEventStreamCoalescer({ timers: clock.timers, onFlush: () => undefined, onPersist: () => undefined })
    for (let index = 0; index < EVENT_WINDOW_LIMIT + 42; index++) coalescer.accept(event(index))
    clock.run()
    const retained = coalescer.window()
    expect(retained[0].id).toBe(`evt-42`)
    expect(retained[retained.length - 1].id).toBe(`evt-${EVENT_WINDOW_LIMIT + 41}`)
  })

  it('rejects a frame already present in the restored window', () => {
    const clock = fakeTimers()
    const coalescer = createEventStreamCoalescer({ restored: [event(1)], timers: clock.timers, onFlush: () => undefined, onPersist: () => undefined })
    expect(coalescer.accept(event(1))).toBe(false)
    expect(coalescer.accept(event(2))).toBe(true)
    expect(coalescer.accept(event(2))).toBe(false)
    clock.run()
    expect(coalescer.window().map((item) => item.id)).toEqual(['evt-1', 'evt-2'])
  })

  // Every disconnect path replaces or clears the EventSource. A flush or a
  // persist scheduled by the previous stream must not write the window of the
  // chat that replaced it.
  it('drops a flush and a persist scheduled by a superseded stream', () => {
    const clock = fakeTimers()
    let current = true
    const flushes: number[] = []
    let persists = 0
    const coalescer = createEventStreamCoalescer({
      timers: clock.timers,
      isCurrent: () => current,
      onFlush: (batch) => flushes.push(batch.length),
      onPersist: () => { persists += 1 },
    })
    coalescer.accept(event(1))
    current = false
    clock.run()
    expect(flushes).toEqual([])
    expect(persists).toBe(0)
  })

  it('cancels pending work on dispose', () => {
    const clock = fakeTimers()
    const flushes: number[] = []
    const coalescer = createEventStreamCoalescer({ timers: clock.timers, onFlush: (batch) => flushes.push(batch.length), onPersist: () => undefined })
    coalescer.accept(event(1))
    coalescer.dispose()
    clock.run()
    expect(flushes).toEqual([])
    expect(clock.pending()).toBe(0)
  })
})
