import { useEffect, useRef } from 'react'

// Plan/execution history reads like the chat transcript: oldest first, newest
// at the bottom. Landing on the surface (or a new Main Request arriving) pins
// the reader to that newest tail instead of the oldest head.
export function useHistoryTail(count: number) {
  const tailRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (count) tailRef.current?.scrollIntoView?.({ block: 'end' }) }, [count])
  return tailRef
}
