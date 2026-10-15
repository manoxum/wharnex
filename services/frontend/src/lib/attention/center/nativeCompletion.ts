import type { CodexThread } from '../../codex/contracts'
import type { WorkspaceChat } from '../../chat/history/workspaceMemory'
import type { AttentionItem } from './attentionCenter'
import { mergeAttentionItems } from './attentionItems'

export function collectNativeAttentionItems(projectPath: string, chats: WorkspaceChat[], threads: CodexThread[]): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const thread of threads) {
    if (!projectPath || thread.projectPath !== projectPath || !thread.native || thread.status !== 'completed') continue
    const chat = chats.find((candidate) => candidate.id === thread.chatId)
    if (!chat || !thread.requestId || !Number.isFinite(Date.parse(thread.completedAt || ''))) continue
    items.push({
      id: `${chat.id}:codex:task-completed:${thread.requestId}`,
      chatId: chat.id,
      chatTitle: chat.title,
      requestId: thread.requestId,
      title: 'Tarefa concluída',
      detail: 'O Codex concluiu o pedido. Consulte o resultado e as alterações no chat.',
      tone: 'success',
      kind: 'task-completed',
      occurredAt: thread.completedAt,
    })
  }
  return mergeAttentionItems(items)
}
