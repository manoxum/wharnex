import type { Dispatch, SetStateAction } from 'react'
import type { ChatItem } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { mergeDurableChatItems } from '../../../lib/chat/history/chatHistory'
import { durableWorkspaceChat, loadChat, saveWorkspaceChats, type WorkspaceChat } from '../../../lib/chat/history/workspaceMemory'

type Params = {
  activeChat: () => string
  setItems: Dispatch<SetStateAction<ChatItem[]>>
  setChats: Dispatch<SetStateAction<WorkspaceChat[]>>
  queueMutation: (chatId: string, projectPath: string, mutate: (items: ChatItem[]) => ChatItem[]) => void
}

// A durable API item and its optimistic renderer item represent one request.
// Use the same reconciliation for live events and later history hydration.
export function createTranscriptAppender({ activeChat, setItems, setChats, queueMutation }: Params) {
  return (target: WorkspaceChat, projectPath: string, item: ChatItem) => {
    const merge = (current: ChatItem[]) => mergeDurableChatItems(current, [item])
    if (target.id === activeChat()) {
      setItems(merge)
      return
    }
    const prior = loadChat(projectPath, target.id)
    if (prior.some((candidate) => candidate.id === item.id && candidate.text === item.text && candidate.iteration?.phase === item.iteration?.phase)) return
    queueMutation(target.id, projectPath, merge)
    setChats((current) => {
      const next = current.map((chat) => chat.id === target.id ? { ...chat, updatedAt: new Date().toISOString() } : chat)
      saveWorkspaceChats(projectPath, next)
      const updated = next.find((chat) => chat.id === target.id)
      if (updated) void api.saveWorkspaceChat(durableWorkspaceChat(projectPath, updated)).catch(() => undefined)
      return next
    })
  }
}

// The API response attaches request identity after an optimistic message was
// painted. Reconcile again at that boundary if the durable event arrived first.
export function createTranscriptMutator({ activeChat, setItems, queueMutation }: Omit<Params, 'setChats'>) {
  return (target: WorkspaceChat, projectPath: string, mutate: (items: ChatItem[]) => ChatItem[]) => {
    const reconcile = (current: ChatItem[]) => {
      const changed = mutate(current)
      return mergeDurableChatItems(changed, changed)
    }
    if (target.id === activeChat()) setItems(reconcile)
    else queueMutation(target.id, projectPath, reconcile)
  }
}
