import { type UIEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem } from '../types'

const INITIAL_ITEM_COUNT = 20
const HISTORY_PAGE_SIZE = 20
const MAX_RENDERED_ITEM_COUNT = 60
const LOAD_MORE_THRESHOLD_PX = 96
const FOLLOW_TAIL_THRESHOLD_PX = 120

export type ChatViewportSnapshot = {
  start: number
  end?: number
  itemCount?: number
  scrollTop: number
  followTail: boolean
}

export type ChatViewportStore = Map<string, ChatViewportSnapshot>

function initialStart(itemCount: number) {
  return Math.max(0, itemCount - INITIAL_ITEM_COUNT)
}

export function useProgressiveChatHistory(items: ChatItem[], activeChatId: string, busy: boolean, viewportStore?: ChatViewportStore) {
  const streamRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const previousChatIdRef = useRef(activeChatId)
  const chatEpochRef = useRef(0)
  const viewportByChatRef = useRef<ChatViewportStore>(viewportStore ?? new Map())
  if (viewportStore && viewportByChatRef.current !== viewportStore) viewportByChatRef.current = viewportStore
  const initialViewportRef = useRef(viewportByChatRef.current.get(activeChatId))
  const initialWindowStart = initialViewportRef.current && !initialViewportRef.current.followTail
    ? Math.min(initialViewportRef.current.start, initialStart(items.length))
    : initialStart(items.length)
  const initialWindowEnd = initialViewportRef.current && !initialViewportRef.current.followTail
    ? Math.min(items.length, Math.max(initialWindowStart, initialViewportRef.current.end ?? initialWindowStart + MAX_RENDERED_ITEM_COUNT))
    : items.length
  const restoreViewportRef = useRef<ChatViewportSnapshot | undefined>(initialViewportRef.current)
  const currentStartRef = useRef(initialWindowStart)
  const currentEndRef = useRef(initialWindowEnd)
  const initialPositionPendingRef = useRef(!initialViewportRef.current)
  const followTailRef = useRef(initialViewportRef.current?.followTail ?? true)
  const loadingOlderRef = useRef(false)
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | undefined>(undefined)
  const [windowState, setWindowState] = useState(() => ({ chatId: activeChatId, epoch: 0, start: initialWindowStart, end: initialWindowEnd, itemCount: items.length }))

  if (previousChatIdRef.current !== activeChatId) {
    const previousChatId = previousChatIdRef.current
    const stream = streamRef.current
    if (stream) {
      viewportByChatRef.current.set(previousChatId, {
        start: currentStartRef.current,
        end: currentEndRef.current,
        itemCount: windowState.itemCount,
        scrollTop: stream.scrollTop,
        followTail: followTailRef.current,
      })
    }

    const savedViewport = viewportByChatRef.current.get(activeChatId)
    previousChatIdRef.current = activeChatId
    chatEpochRef.current += 1
    restoreViewportRef.current = savedViewport
    initialPositionPendingRef.current = !savedViewport
    followTailRef.current = savedViewport?.followTail ?? true
    loadingOlderRef.current = false
    prependSnapshotRef.current = undefined
  }

  const newestStart = initialStart(items.length)
  const stateMatchesChat = windowState.chatId === activeChatId && windowState.epoch === chatEpochRef.current
  const stateWasAtTail = windowState.end === windowState.itemCount && windowState.start === initialStart(windowState.itemCount)
  const savedViewport = viewportByChatRef.current.get(activeChatId)
  const restoredStart = savedViewport && !followTailRef.current ? Math.min(savedViewport.start, newestStart) : newestStart
  const savedEnd = savedViewport?.end ?? restoredStart + MAX_RENDERED_ITEM_COUNT
  const restoredWindowEnd = savedViewport?.itemCount === savedEnd && items.length - restoredStart <= MAX_RENDERED_ITEM_COUNT ? items.length : savedEnd
  const restoredEnd = savedViewport && !followTailRef.current
    ? Math.min(items.length, Math.max(restoredStart, restoredWindowEnd))
    : items.length
  const keepWindow = stateMatchesChat && (!followTailRef.current || !stateWasAtTail)
  const start = keepWindow ? Math.min(windowState.start, newestStart) : restoredStart
  const keptEnd = windowState.end === windowState.itemCount && items.length - start <= MAX_RENDERED_ITEM_COUNT ? items.length : windowState.end
  const end = keepWindow ? Math.min(items.length, Math.max(start, keptEnd)) : restoredEnd
  currentStartRef.current = start
  currentEndRef.current = end
  const visibleItems = useMemo(() => items.slice(start, end), [end, items, start])

  const loadOlder = useCallback(() => {
    const stream = streamRef.current
    if (!stream || start <= 0 || loadingOlderRef.current) return
    loadingOlderRef.current = true
    prependSnapshotRef.current = { scrollHeight: stream.scrollHeight, scrollTop: stream.scrollTop }
    const nextStart = Math.max(0, start - HISTORY_PAGE_SIZE)
    const nextEnd = Math.min(end, nextStart + MAX_RENDERED_ITEM_COUNT)
    setWindowState({ chatId: activeChatId, epoch: chatEpochRef.current, start: nextStart, end: nextEnd, itemCount: items.length })
  }, [activeChatId, end, items.length, start])

  const loadNewer = useCallback(() => {
    if (end >= items.length) return
    const nextEnd = Math.min(items.length, end + HISTORY_PAGE_SIZE)
    const nextStart = Math.max(0, Math.min(start, nextEnd - MAX_RENDERED_ITEM_COUNT))
    setWindowState({ chatId: activeChatId, epoch: chatEpochRef.current, start: nextStart, end: nextEnd, itemCount: items.length })
  }, [activeChatId, end, items.length, start])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const stream = event.currentTarget
    followTailRef.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight <= FOLLOW_TAIL_THRESHOLD_PX
    viewportByChatRef.current.set(activeChatId, {
      start: currentStartRef.current,
      end: currentEndRef.current,
      itemCount: items.length,
      scrollTop: stream.scrollTop,
      followTail: followTailRef.current,
    })
    if (stream.scrollTop <= LOAD_MORE_THRESHOLD_PX) loadOlder()
  }, [activeChatId, loadOlder])

  useLayoutEffect(() => {
    const stream = streamRef.current
    if (!stream) return

    const prependSnapshot = prependSnapshotRef.current
    if (prependSnapshot) {
      stream.scrollTop = prependSnapshot.scrollTop + Math.max(0, stream.scrollHeight - prependSnapshot.scrollHeight)
      viewportByChatRef.current.set(activeChatId, {
        start: currentStartRef.current,
        end: currentEndRef.current,
        itemCount: items.length,
        scrollTop: stream.scrollTop,
        followTail: followTailRef.current,
      })
      prependSnapshotRef.current = undefined
      loadingOlderRef.current = false
      return
    }

    const restoreViewport = restoreViewportRef.current
    if (restoreViewport) {
      restoreViewportRef.current = undefined
      if (restoreViewport.followTail) endRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' })
      else stream.scrollTop = restoreViewport.scrollTop
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
    hasNewer: end < items.length,
    hiddenItemCount: start,
    hiddenNewerItemCount: items.length - end,
    loadOlder,
    loadNewer,
    onScroll,
    streamRef,
    visibleItems,
  }
}
