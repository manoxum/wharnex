import { useState } from 'react'
import type { Session, WorkspaceMode } from '../types'
import type { AttentionItem, AttentionTarget } from './attentionCenter'

type ChatRef = { id: string }

type Options = {
  session?: Session
  activeChatId: string
  chats: ChatRef[]
  allAttentionItems: AttentionItem[]
  chatgptHumanActionActive: boolean
  acknowledge: (item: AttentionItem) => void
  openHumanAction: () => Promise<unknown>
  setMode: (mode: WorkspaceMode) => void
  selectChat: (chatId: string) => Promise<unknown>
  openRestart: (chatId?: string) => Promise<unknown>
  focusInspector: (target: AttentionTarget) => void
}

export function useAttentionNavigation({ session, activeChatId, chats, allAttentionItems, chatgptHumanActionActive, acknowledge, openHumanAction, setMode, selectChat, openRestart, focusInspector }: Options) {
  const [orchestratorTaskFocus, setOrchestratorTaskFocus] = useState<{ projectPath: string; taskId: string; nonce: number }>({ projectPath: '', taskId: '', nonce: 0 })

  function openOrchestratorTask(taskId: string) {
    const target = taskId.trim()
    if (!session || !target) return
    setMode('orchestrator')
    setOrchestratorTaskFocus((current) => ({ projectPath: session.project_path, taskId: target, nonce: current.nonce + 1 }))
  }

  async function openAttentionItem(item: AttentionItem) {
    acknowledge(item)
    if (item.id.endsWith(':chatgpt-human-action') && item.chatId === activeChatId && chatgptHumanActionActive) {
      await openHumanAction()
      return
    }
    if (item.kind === 'task-completed' && item.orchestratorTaskId) {
      openOrchestratorTask(item.orchestratorTaskId)
      return
    }
    setMode('agent')
    if (item.chatId !== activeChatId && chats.some((chat) => chat.id === item.chatId)) await selectChat(item.chatId)
    if (item.kind === 'restart-pending') {
      await openRestart(item.chatId)
      return
    }
    if (item.target) focusInspector(item.target)
  }

  async function openDesktopNotification(notice: DesktopCompletionNotification) {
    if (notice.kind === 'task-completed') {
      const completed = allAttentionItems.find((item) => item.id === notice.id && item.kind === 'task-completed')
      if (completed) {
        acknowledge(completed)
        if (completed.orchestratorTaskId) {
          openOrchestratorTask(completed.orchestratorTaskId)
          return
        }
      }
    }
    setMode('agent')
    if (notice.chatId && notice.chatId !== activeChatId && chats.some((chat) => chat.id === notice.chatId)) await selectChat(notice.chatId)
    if (notice.kind === 'restart-pending') await openRestart(notice.chatId)
  }

  return { orchestratorTaskFocus, openAttentionItem, openDesktopNotification }
}
