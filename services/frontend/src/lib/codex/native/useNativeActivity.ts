import { useEffect, useRef } from 'react'
import type { ChatItem } from '../../../types'
import type { WorkspaceChat } from '../../chat/history/workspaceMemory'
import { useCodexStatus } from '../useCodexStatus'

type Mutate = (chat: WorkspaceChat, projectPath: string, mutate: (items: ChatItem[]) => ChatItem[]) => void
export function useNativeActivity(projectPath: string, chats: WorkspaceChat[], mutate: Mutate) {
  const callbacks = useRef({ chats, mutate })
  callbacks.current = { chats, mutate }
  const status = useCodexStatus(projectPath, Boolean(projectPath && chats.some((chat) => chat.engine === 'codex')))
  const seen = useRef(new Set<string>())
  useEffect(() => {
    for (const thread of status.threads || status.data?.threads || []) {
      if (!thread.native || !['completed', 'idle', 'attention'].includes(thread.status)) continue
      const chat = callbacks.current.chats.find((item) => item.id === thread.chatId)
      if (!chat) continue
      const messages = thread.messages.filter((item) => item.role === 'assistant' && !seen.current.has(`${thread.threadId}:${item.id}:${item.text}`))
      if (!messages.length) continue
      for (const message of messages) seen.current.add(`${thread.threadId}:${message.id}:${message.text}`)
      callbacks.current.mutate(chat, projectPath, (items) => {
        const added: ChatItem[] = messages.map((message) => ({ id: `codex-${thread.threadId}-${message.id}`, role: 'harness', source: 'codex', presentation: 'message', text: message.text, meta: 'Codex · execução nativa', createdAt: thread.completedAt || new Date().toISOString() }))
        return [...items.filter((item) => !added.some((entry) => entry.id === item.id)), ...added]
      })
    }
  }, [status.data, status.threads, projectPath, chats])
  return (status.threads || status.data?.threads || []).filter((thread) => thread.native)
}
