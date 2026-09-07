import { type UIEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem } from '../types'

const INITIAL_ITEM_COUNT = 20
const HISTORY_PAGE_SIZE = 20
const LOAD_MORE_THRESHOLD_PX = 96
const FOLLOW_TAIL_THRESHOLD_PX = 120

function initialStart(itemCount: number) {
  return Math.max(0, itemCount - INITIAL_ITEM_COUNT)
}

export function useProgressiveChatHistory(items: ChatItem[], activeChatId: string, busy: boolean) {
  const streamRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const previousChatIdRef = useRef(activeChatId)
  const chatEpochRef = useRef(0)
  const initialPositionPendingRef = useRef(true)
  const followTailRef = useRef(true)
  const loadingOlderRef = useRef(false)
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | undefined>(undefined)
  const [windowState, setWindowState] = useState(() => ({ chatId: activeChatId, epoch: 0, start: initialStart(items.length), itemCount: items.length }))

  if (previousChatIdRef.current !== activeChatId) {
    previousChatIdRef.current = activeChatId
    chatEpochRef.current += 1
    initialPositionPendingRef.current = true
    followTailRef.current = true
    loadingOlderRef.current = false
    prependSnapshotRef.current = undefined
  }

  const newestStart = initialStart(items.length)
  const stateMatchesChat = windowState.chatId === activeChatId && windowState.epoch === chatEpochRef.current
  const stateWasAtTail = windowState.start === initialStart(windowState.itemCount)
  const start = stateMatchesChat && (!followTailRef.current || !stateWasAtTail) ? Math.min(windowState.start, newestStart) : newestStart
  const visibleItems = useMemo(() => items.slice(start), [items, start])

  const loadOlder = useCallback(() => {
    const stream = streamRef.current
    if (!stream || start <= 0 || loadingOlderRef.current) return
    loadingOlderRef.current = true
    prependSnapshotRef.current = { scrollHeight: stream.scrollHeight, scrollTop: stream.scrollTop }
    setWindowState({ chatId: activeChatId, epoch: chatEpochRef.current, start: Math.max(0, start - HISTORY_PAGE_SIZE), itemCount: items.length })
  }, [activeChatId, items.length, start])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const stream = event.currentTarget
    followTailRef.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight <= FOLLOW_TAIL_THRESHOLD_PX
    if (stream.scrollTop <= LOAD_MORE_THRESHOLD_PX) loadOlder()
  }, [loadOlder])

  useLayoutEffect(() => {
    const stream = streamRef.current
    if (!stream) return

    const prependSnapshot = prependSnapshotRef.current
    if (prependSnapshot) {
      stream.scrollTop = prependSnapshot.scrollTop + Math.max(0, stream.scrollHeight - prependSnapshot.scrollHeight)
      prependSnapshotRef.current = undefined
      loadingOlderRef.current = false
      return
    }

    if (initialPositionPendingRef.current) {
      endRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' })
      initialPositionPendingRef.current = false
      return
    }

    if (followTailRef.current) endRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' })
  }, [activeChatId, busy, items, start])

  return {
    endRef,
    hasOlder: start > 0,
    hiddenItemCount: start,
    loadOlder,
    onScroll,
    streamRef,
    visibleItems,
  }
}
