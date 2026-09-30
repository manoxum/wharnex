import { api } from '../../lib/transport/http/api'
import { durableWorkspaceChat, loadArchivedWorkspaceChats, loadChat, loadSavedWorkspaceChats, loadWorkspaceChats, mergeDurableWorkspaceChats, saveArchivedWorkspaceChats, saveChat, saveSavedWorkspaceChats, saveWorkspaceChats } from '../../lib/chat/history/workspaceMemory'
import { mergeDurableChatItems } from '../../lib/chat/history/chatHistory'

export async function hydrateWorkspaceMemory(projectPath: string) {
    const localActive = loadWorkspaceChats(projectPath)
    const localSaved = loadSavedWorkspaceChats(projectPath)
    const localArchived = loadArchivedWorkspaceChats(projectPath)
    const local = [...localActive, ...localSaved, ...localArchived]
    try {
      const response = await api.workspaceChats(projectPath)
      const merged = mergeDurableWorkspaceChats(local, response.chats || [])
      const active = merged.filter((chat) => !chat.savedAt && !chat.archivedAt).slice(0, 30)
      const saved = merged.filter((chat) => Boolean(chat.savedAt) && !chat.archivedAt).slice(0, 30)
      const archived = merged.filter((chat) => Boolean(chat.archivedAt)).slice(0, 30)
      saveWorkspaceChats(projectPath, active)
      saveSavedWorkspaceChats(projectPath, saved)
      saveArchivedWorkspaceChats(projectPath, archived)

      // One-way compatibility migration for installations which already had
      // browser-only chats before the durable table was introduced.
      const durableIDs = new Set((response.chats || []).map((chat) => chat.id))
      await Promise.allSettled(local.filter((chat) => !durableIDs.has(chat.id)).map(async (chat) => {
        await api.saveWorkspaceChat(durableWorkspaceChat(projectPath, chat))
        const transcript = loadChat(projectPath, chat.id)
        if (transcript.length) await api.replaceWorkspaceChatItems(chat.id, transcript)
      }))
      return { active, saved, archived }
    } catch {
      // Backend unavailability must not prevent the already-cached workspace
      // from opening; later writes retry the durable upsert best-effort.
      return { active: localActive, saved: localSaved, archived: localArchived }
    }
  }

export async function hydrateChatTranscript(projectPath: string, chatId: string) {
    const local = loadChat(projectPath, chatId)
    try {
      const response = await api.workspaceChatItems(chatId)
      const durable = (response.items || []).map((item) => item.payload)
      const merged = mergeDurableChatItems(local, durable)
      saveChat(projectPath, chatId, merged)
      return merged
    } catch {
      return local
    }
  }
