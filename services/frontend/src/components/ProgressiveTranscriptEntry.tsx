import { startTransition, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

type HydrationTask = { id: number; priority: number; run: () => void }

const hydrationQueue: HydrationTask[] = []
let nextTaskId = 0
let scheduledKind: 'raf' | 'timeout' | undefined
let scheduledHandle: number | undefined

function cancelScheduledFlush() {
  if (scheduledHandle === undefined || !scheduledKind) return
  if (scheduledKind === 'raf' && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(scheduledHandle)
  else window.clearTimeout(scheduledHandle)
  scheduledHandle = undefined
  scheduledKind = undefined
}

function scheduleHydrationFlush() {
  if (scheduledKind || !hydrationQueue.length) return
  const flush = () => {
    scheduledHandle = undefined
    scheduledKind = undefined
    hydrationQueue.shift()?.run()
    scheduleHydrationFlush()
  }
  if (typeof window.requestAnimationFrame === 'function') {
    scheduledKind = 'raf'
    scheduledHandle = window.requestAnimationFrame(flush)
  } else {
    scheduledKind = 'timeout'
    scheduledHandle = window.setTimeout(flush, 0)
  }
}

function enqueueHydration(priority: number, run: () => void) {
  const task = { id: ++nextTaskId, priority, run }
  const index = hydrationQueue.findIndex((candidate) => candidate.priority < priority)
  if (index < 0) hydrationQueue.push(task)
  else hydrationQueue.splice(index, 0, task)
  scheduleHydrationFlush()
  return () => {
    const pending = hydrationQueue.findIndex((candidate) => candidate.id === task.id)
    if (pending >= 0) hydrationQueue.splice(pending, 1)
    if (!hydrationQueue.length) cancelScheduledFlush()
  }
}

export function ProgressiveTranscriptEntry({ streamRef, deferUntilNear, priority, variant, children }: {
  streamRef: RefObject<HTMLDivElement | null>
  deferUntilNear: boolean
  priority: number
  variant: 'user' | 'assistant'
  children: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(!deferUntilNear)
  const [hydrated, setHydrated] = useState(!deferUntilNear)

  useEffect(() => {
    if (!deferUntilNear || hydrated || nearViewport) return
    const host = hostRef.current
    if (!host) return
    if (typeof IntersectionObserver === 'undefined') {
      startTransition(() => setHydrated(true))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setNearViewport(true)
      observer.disconnect()
    }, { root: streamRef.current, rootMargin: '480px 0px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [deferUntilNear, hydrated, nearViewport, streamRef])

  useEffect(() => {
    if (!nearViewport || hydrated) return
    return enqueueHydration(priority, () => {
      startTransition(() => setHydrated(true))
    })
  }, [hydrated, nearViewport, priority])

  return <div ref={hostRef} className={hydrated ? 'chat-rich-entry' : 'chat-rich-entry deferred'} aria-busy={hydrated ? undefined : true}>
    {hydrated ? children : <div className={`chat-entry-skeleton ${variant}`} aria-hidden="true"><span/><i/><i/><i/></div>}
  </div>
}
