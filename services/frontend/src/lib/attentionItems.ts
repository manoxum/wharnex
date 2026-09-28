import type { AttentionItem, AttentionTone } from './attentionCenter'

export function mergeAttentionItems(...groups: AttentionItem[][]): AttentionItem[] {
  const unique = new Map<string, AttentionItem>()
  for (const group of groups) {
    for (const entry of group) if (!unique.has(entry.id)) unique.set(entry.id, entry)
  }
  return [...unique.values()].sort(compareAttentionItems)
}

export function compareAttentionItems(left: AttentionItem, right: AttentionItem) {
  return attentionRank(left.tone) - attentionRank(right.tone)
    || left.chatTitle.localeCompare(right.chatTitle)
    || left.title.localeCompare(right.title)
}

function attentionRank(tone: AttentionTone) {
  if (tone === 'danger') return 0
  if (tone === 'warning') return 1
  return 2
}
