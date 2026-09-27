import { splitTerminalInput } from './interactiveTerminalSupport'

export type TerminalInputQueue = {
  push: (data: string) => void
  setReady: (ready: boolean) => void
  dispose: () => void
}

// Keystrokes for one host PTY, delivered in order with at most one request in
// flight. Typing during that request is coalesced into the next one.
//
// Input waits while the transport is not ready — a restored tab is still
// reattaching, or a reconnect is under way — instead of being posted to a
// terminal id the current session does not own yet, which failed as a stale
// session and lost the keystrokes. A failed send puts every unsent chunk back
// at the front of the queue and asks for a reconnect; delivery resumes once
// the caller marks the transport ready again.
export function createTerminalInputQueue(send: (chunk: string) => Promise<void>, onStale: () => void): TerminalInputQueue {
  let buffer = ''
  let ready = false
  let scheduled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let disposed = false

  const schedule = () => {
    if (disposed || !ready || scheduled || inFlight || !buffer) return
    scheduled = true
    timer = setTimeout(() => {
      timer = undefined
      scheduled = false
      void flush()
    }, 8)
  }

  const flush = async () => {
    if (disposed || !ready || inFlight || !buffer) return
    const chunks = splitTerminalInput(buffer)
    buffer = ''
    inFlight = true
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        try {
          await send(chunks[index])
        } catch {
          buffer = `${chunks.slice(index).join('')}${buffer}`
          ready = false
          if (!disposed) onStale()
          break
        }
      }
    } finally {
      inFlight = false
      schedule()
    }
  }

  return {
    push: (data) => { buffer += data; schedule() },
    setReady: (next) => { ready = next; schedule() },
    dispose: () => { disposed = true; if (timer) clearTimeout(timer) },
  }
}
