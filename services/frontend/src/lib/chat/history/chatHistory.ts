import type { ChatItem } from '../../../types'

// The backend transcript is the durable copy; localStorage is only a small,
// synchronous cache used to make tab switches instant. Merge by stable item id
// so a local write that has not reached the backend yet is retained without
// letting the 80-item cache truncate a longer durable history after restart.
export function mergeDurableChatItems(local: ChatItem[], durable: ChatItem[]): ChatItem[] {
  const merged = new Map<string, ChatItem>()
  for (const item of durable) if (validChatItem(item)) merged.set(item.id, item)
  for (const item of local) if (validChatItem(item) && !merged.has(item.id)) merged.set(item.id, item)
  const localRequests = new Map<string, ChatItem>()
  for (const item of local) {
    if (!validChatItem(item)) continue
    const key = requestKey(item)
    const previous = localRequests.get(key)
    if (key && (!previous || previous.id.startsWith('request:') && !item.id.startsWith('request:'))) localRequests.set(key, item)
  }
  const requests = new Set<string>()
  const reconciled: ChatItem[] = []
  for (const item of merged.values()) {
    const key = requestKey(item)
    if (key && requests.has(key)) continue
    if (key) requests.add(key)
    const optimistic = key ? localRequests.get(key) : undefined
    reconciled.push(optimistic && optimistic.id !== item.id ? optimistic : item)
  }
  return reconciled.sort((left, right) => {
    const time = Date.parse(left.createdAt || '') - Date.parse(right.createdAt || '')
    return Number.isFinite(time) && time !== 0 ? time : 0
  })
}

function requestKey(item: ChatItem): string {
  return item.role === 'user' && item.iteration?.phase === 'outbound' ? item.iteration.requestId : ''
}

function validChatItem(item: ChatItem | undefined): item is ChatItem {
  return Boolean(item && typeof item.id === 'string' && item.id && typeof item.text === 'string' && (item.role === 'user' || item.role === 'harness'))
}
