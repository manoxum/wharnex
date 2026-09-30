import type { AttentionItem } from './attentionCenter'

const ATTENTION_HISTORY_PREFIX = 'whx.attention.history.v1:'
const ATTENTION_HISTORY_LIMIT = 100

export function loadCompletedAttentionHistory(projectPath: string): AttentionItem[] {
  if (!projectPath) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(ATTENTION_HISTORY_PREFIX + projectPath) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCompletedAttentionItem).slice(0, ATTENTION_HISTORY_LIMIT)
  } catch {
    return []
  }
}

export function acknowledgeCompletedAttention(projectPath: string, item: AttentionItem, current: AttentionItem[]): AttentionItem[] {
  if (!projectPath || item.kind !== 'task-completed') return current
  const next = [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, ATTENTION_HISTORY_LIMIT)
  try { localStorage.setItem(ATTENTION_HISTORY_PREFIX + projectPath, JSON.stringify(next)) } catch { /* best effort */ }
  return next
}

export function filterActiveAttentionItems(items: AttentionItem[], history: AttentionItem[]): AttentionItem[] {
  if (!history.length) return items
  const acknowledged = new Set(history.map((entry) => entry.id))
  return items.filter((entry) => entry.kind !== 'task-completed' || !acknowledged.has(entry.id))
}

function isCompletedAttentionItem(value: unknown): value is AttentionItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<AttentionItem>
  return item.kind === 'task-completed'
    && typeof item.id === 'string'
    && typeof item.chatId === 'string'
    && typeof item.chatTitle === 'string'
    && typeof item.title === 'string'
    && typeof item.detail === 'string'
    && item.tone === 'success'
}
