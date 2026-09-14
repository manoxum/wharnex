import type { ChatItem } from '../types'

// The backend transcript is the durable copy; localStorage is only a small,
// synchronous cache used to make tab switches instant. Merge by stable item id
// so a local write that has not reached the backend yet is retained without
// letting the 80-item cache truncate a longer durable history after restart.
export function mergeDurableChatItems(local: ChatItem[], durable: ChatItem[]): ChatItem[] {
  const merged = new Map<string, ChatItem>()
  for (const item of durable) if (validChatItem(item)) merged.set(item.id, item)
  for (const item of local) if (validChatItem(item) && !merged.has(item.id)) merged.set(item.id, item)
  return [...merged.values()].sort((left, right) => {
    const time = Date.parse(left.createdAt || '') - Date.parse(right.createdAt || '')
    return Number.isFinite(time) && time !== 0 ? time : 0
  })
}

function validChatItem(item: ChatItem | undefined): item is ChatItem {
  return Boolean(item && typeof item.id === 'string' && item.id && typeof item.text === 'string' && (item.role === 'user' || item.role === 'harness'))
}
