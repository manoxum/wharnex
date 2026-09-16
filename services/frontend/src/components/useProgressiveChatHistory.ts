import { type UIEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem } from '../types'

const INITIAL_ITEM_COUNT = 20
const HISTORY_PAGE_SIZE = 20
const MAX_RENDERED_ITEM_COUNT = 60
const ESTIMATED_ITEM_HEIGHT_PX = 180
const FOLLOW_TAIL_THRESHOLD_PX = 120

export type ChatViewportSnapshot = {
  start: number
  end?: number
  itemCount?: number
  scrollTop: number
  followTail: boolean
}

export type ChatViewportStore = Map<string, ChatViewportSnapshot>

type WindowState = { chatId: string; epoch: number; start: number; end: number; itemCount: number }

function initialStart(itemCount: number) {
  return Math.max(0, itemCount - INITIAL_ITEM_COUNT)
}

function windowForIndex(itemCount: number, index: number) {
  const start = Math.max(0, Math.min(index, Math.max(0, itemCount - MAX_RENDERED_ITEM_COUNT)))
  return { start, end: Math.min(itemCount, start + MAX_RENDERED_ITEM_COUNT) }
}

// The spacers preserve the geometry of the complete transcript while the DOM
// retains only a bounded viewport. The old page-only window had no geometry
// for unloaded history, so dragging the scrollbar could not move its content.
export function useProgressiveChatHistory(items: ChatItem[], activeChatId: string, busy: boolean, viewportStore?: ChatViewportStore) {
  const streamRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const previousChatIdRef = useRef(activeChatId)
  const chatEpochRef = useRef(0)
  const viewportByChatRef = useRef<ChatViewportStore>(viewportStore ?? new Map())
  if (viewportStore && viewportByChatRef.current !== viewportStore) viewportByChatRef.current = viewportStore

  const initialViewportRef = useRef(viewportByChatRef.current.get(activeChatId))
  const initialWindow = initialViewportRef.current && !initialViewportRef.current.followTail
    ? windowForIndex(items.length, initialViewportRef.current.start)
    : { start: initialStart(items.length), end: items.length }
  const restoreViewportRef = useRef<ChatViewportSnapshot | undefined>(initialViewportRef.current)
  const currentStartRef = useRef(initialWindow.start)
  const currentEndRef = useRef(initialWindow.end)
  const followTailRef = useRef(initialViewportRef.current?.followTail ?? true)
  const initialPositionPendingRef = useRef(!initialViewportRef.current)
  const [windowState, setWindowState] = useState<WindowState>(() => ({ chatId: activeChatId, epoch: 0, ...initialWindow, itemCount: items.length }))

  if (previousChatIdRef.current !== activeChatId) {
    const previousChatId = previousChatIdRef.current
    const stream = streamRef.current
    if (stream) viewportByChatRef.current.set(previousChatId, {
      start: currentStartRef.current, end: currentEndRef.current, itemCount: windowState.itemCount,
      scrollTop: stream.scrollTop, followTail: followTailRef.current,
    })
    const saved = viewportByChatRef.current.get(activeChatId)
    previousChatIdRef.current = activeChatId
    chatEpochRef.current += 1
    restoreViewportRef.current = saved
    initialPositionPendingRef.current = !saved
    followTailRef.current = saved?.followTail ?? true
  }

  const stateMatchesChat = windowState.chatId === activeChatId && windowState.epoch === chatEpochRef.current
  const stateAtTail = windowState.end === windowState.itemCount && windowState.start === initialStart(windowState.itemCount)
  const saved = viewportByChatRef.current.get(activeChatId)
  const fallback = saved && !followTailRef.current
    ? windowForIndex(items.length, saved.start)
    : { start: initialStart(items.length), end: items.length }
  const keepWindow = stateMatchesChat && (!followTailRef.current || !stateAtTail)
  const current = keepWindow ? windowForIndex(items.length, windowState.start) : fallback
  const start = current.start
  const end = current.end
  currentStartRef.current = start
  currentEndRef.current = end
  const visibleItems = useMemo(() => items.slice(start, end), [end, items, start])

  const setWindowAt = useCallback((index: number) => {
    const next = windowForIndex(items.length, index)
    if (next.start === currentStartRef.current && next.end === currentEndRef.current) return
    setWindowState({ chatId: activeChatId, epoch: chatEpochRef.current, ...next, itemCount: items.length })
  }, [activeChatId, items.length])

  const jumpTo = useCallback((index: number) => {
    const stream = streamRef.current
    if (!stream) return
    const next = windowForIndex(items.length, index)
    stream.scrollTop = next.start * ESTIMATED_ITEM_HEIGHT_PX
    followTailRef.current = next.end === items.length
    setWindowState({ chatId: activeChatId, epoch: chatEpochRef.current, ...next, itemCount: items.length })
  }, [activeChatId, items.length])

  const loadOlder = useCallback(() => jumpTo(Math.max(0, start - HISTORY_PAGE_SIZE)), [jumpTo, start])
  const loadNewer = useCallback(() => jumpTo(Math.min(Math.max(0, items.length - MAX_RENDERED_ITEM_COUNT), start + HISTORY_PAGE_SIZE)), [items.length, jumpTo, start])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const stream = event.currentTarget
    followTailRef.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight <= FOLLOW_TAIL_THRESHOLD_PX
    setWindowAt(Math.floor(Math.max(0, stream.scrollTop) / ESTIMATED_ITEM_HEIGHT_PX))
    viewportByChatRef.current.set(activeChatId, {
      start: currentStartRef.current, end: currentEndRef.current, itemCount: items.length,
      scrollTop: stream.scrollTop, followTail: followTailRef.current,
    })
  }, [activeChatId, items.length, setWindowAt])

  useLayoutEffect(() => {
    const stream = streamRef.current
    if (!stream) return
    const restore = restoreViewportRef.current
    if (restore) {
      restoreViewportRef.current = undefined
      if (restore.followTail) endRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' })
      else stream.scrollTop = restore.scrollTop
      return
    }
    if (initialPositionPendingRef.current) {
      endRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' })
      initialPositionPendingRef.current = false
      return
    }
    if (followTailRef.current) endRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' })
  }, [activeChatId, busy, end, items, start])

  return {
    beforeHeight: start * ESTIMATED_ITEM_HEIGHT_PX,
    afterHeight: Math.max(0, items.length - end) * ESTIMATED_ITEM_HEIGHT_PX,
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
