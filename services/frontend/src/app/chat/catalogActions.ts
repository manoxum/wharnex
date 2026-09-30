import type { Dispatch, SetStateAction } from 'react'
import type { Session } from '../../types'
import { api, APIError } from '../../lib/transport/http/api'
import { desktopBridge, isDesktop } from '../../lib/desktop/bridge/desktop'
import { confirmDialog } from '../../lib/desktop/bridge/appDialog'
import { archiveSavedChat as archiveStoredSavedChat, durableWorkspaceChat, removeArchivedChat as removeStoredArchivedChat, saveArchivedWorkspaceChats, saveSavedWorkspaceChats, saveWorkspaceChats, type ChatNaming, type RemoteArchive, type WorkspaceChat } from '../../lib/chat/history/workspaceMemory'
import { errorMessage as messageOf } from '../../lib/workspace/dialogs/errorMessage'
import { chatGPTProjectName } from './transcriptMetadata'

type Params = {
  session?: Session
  busy: boolean
  chats: WorkspaceChat[]
  savedChats: WorkspaceChat[]
  archivedChats: WorkspaceChat[]
  setBusy: (value: boolean) => void
  setError: Dispatch<SetStateAction<string | undefined>>
  setChats: Dispatch<SetStateAction<WorkspaceChat[]>>
  setSavedChats: Dispatch<SetStateAction<WorkspaceChat[]>>
  setArchivedChats: Dispatch<SetStateAction<WorkspaceChat[]>>
}

export function createChatCatalogActions({ session, busy, chats, savedChats, archivedChats, setBusy, setError, setChats, setSavedChats, setArchivedChats }: Params) {
  async function archiveSavedChat(chatId: string) {
    if (!session || busy) return
    const target = savedChats.find((chat) => chat.id === chatId)
    if (!target) return
    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      const bridge = desktopBridge()
      let remoteArchive: RemoteArchive = bridge && target.chatgptUrl
        ? { state: 'pending', attempts: 0, lastState: 'queue-pending' }
        : { state: 'not-applicable', attempts: 0 }
      await api.setWorkspaceChatArchived(chatId, true)
      const moved = archiveStoredSavedChat(projectPath, chatId, remoteArchive)
      if (bridge && target.chatgptUrl) {
        try {
          const queued = await bridge.chatgpt.queueArchive({ cacheKey: chatId, url: target.chatgptUrl, sessionId: target.sessionId, projectId: projectPath })
          remoteArchive = { state: 'pending', attempts: 0, lastState: queued.state, lastAttemptAt: new Date().toISOString() }
        } catch (cause) {
          remoteArchive = { state: 'pending', attempts: 0, lastState: `queue-error: ${messageOf(cause).slice(0, 180)}`, lastAttemptAt: new Date().toISOString() }
        }
        moved.archived = moved.archived.map((chat) => chat.id === chatId ? { ...chat, remoteArchive } : chat)
        saveArchivedWorkspaceChats(projectPath, moved.archived)
      }
      try { await api.archiveChat(target.sessionId) } catch { /* durable workspace-chat archive remains authoritative */ }
      try { await bridge?.chatgpt.release?.(chatId) } catch { /* lifecycle task is durable */ }
      setSavedChats(moved.saved); setArchivedChats(moved.archived)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function deleteArchivedChat(chatId: string) {
    if (!session || busy) return
    const target = archivedChats.find((chat) => chat.id === chatId)
    if (!target) return
    if (!(await confirmDialog({
      title: 'Eliminar Harness Chat?',
      message: `“${target.title}” será eliminado definitivamente do histórico local e os anexos do Wharnex serão apagados. Se existir uma conversa ChatGPT associada, a eliminação remota será colocada na fila durável dos Workers.`,
      tone: 'danger',
      confirmLabel: 'Eliminar chat',
    }))) return

    setBusy(true); setError(undefined)
    try {
      if (target.chatgptUrl && isDesktop()) {
        const queued = await desktopBridge()?.chatgpt.queueDelete({ cacheKey: chatId, url: target.chatgptUrl, sessionId: target.sessionId, projectId: session.project_path })
        if (!queued?.ok) throw new Error('Não foi possível colocar a eliminação remota na fila dos Workers.')
      }
      try { await api.deleteSession(target.sessionId) }
      catch (error) { if (!(error instanceof APIError) || error.status !== 404) throw error }
      if (isDesktop()) {
        try { await desktopBridge()?.attachments.removeChat({ cacheKey: chatId }) } catch { /* permanent local deletion should continue even if orphan cleanup fails */ }
        try { await desktopBridge()?.chatgpt.release?.(chatId) } catch { /* the lifecycle task is durable; releasing the Supervisor is best-effort */ }
      }
      setArchivedChats(removeStoredArchivedChat(session.project_path, chatId))
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function renameWorkspaceChat(chatId: string, requestedTitle: string) {
    if (!session) return
    const title = requestedTitle.replace(/\s+/g, ' ').trim().slice(0, 82)
    if (!title) return
    const target = chats.find((chat) => chat.id === chatId) || savedChats.find((chat) => chat.id === chatId) || archivedChats.find((chat) => chat.id === chatId)
    if (!target) return
    setBusy(true); setError(undefined)
    try {
      const updatedAt = new Date().toISOString()
      // The local title is definitive immediately. Remote organization is a
      // durable background task and cannot veto or roll back the user's title.
      const naming: ChatNaming = { state: 'definitive', attempts: (target.naming?.attempts || 0) + 1, lastAttemptAt: updatedAt, projectAssigned: true }
      const updated = { ...target, title, updatedAt, naming }
      setChats((current) => { const next = current.map((chat) => chat.id === chatId ? updated : chat); saveWorkspaceChats(session.project_path, next); return next })
      setSavedChats((current) => { const next = current.map((chat) => chat.id === chatId ? updated : chat); saveSavedWorkspaceChats(session.project_path, next); return next })
      setArchivedChats((current) => { const next = current.map((chat) => chat.id === chatId ? updated : chat); saveArchivedWorkspaceChats(session.project_path, next); return next })
      await api.saveWorkspaceChat(durableWorkspaceChat(session.project_path, updated))
      if (target.chatgptUrl && !target.savedAt && isDesktop()) {
        try {
          await desktopBridge()?.chatgpt.queueRename({ cacheKey: target.id, url: target.chatgptUrl, sessionId: target.sessionId, projectId: session.project_path, projectName: chatGPTProjectName(session.project_path), title })
        } catch (cause) {
          setError(`Nome local alterado; a renomeação remota não entrou na fila: ${messageOf(cause)}`)
        }
      }
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  async function generateWorkspaceChatTitle(chatId: string) {
    if (!session || !isDesktop()) return
    const target = chats.find((chat) => chat.id === chatId) || savedChats.find((chat) => chat.id === chatId) || archivedChats.find((chat) => chat.id === chatId)
    if (target?.savedAt) { setError('Reative o chat antes de pedir operações remotas.'); return }
    if (!target?.chatgptUrl) { setError('Este chat ainda não possui uma conversa ChatGPT capaz de fornecer o nome contextual.'); return }
    setBusy(true); setError(undefined)
    try {
      const suggestion = await desktopBridge()?.chatgpt.suggestTitle(target.id, target.chatgptUrl)
      if (!suggestion?.ok || !suggestion.title) throw new Error('O título contextual do ChatGPT ainda não está disponível.')
      await renameWorkspaceChat(chatId, suggestion.title.replace(/^WHX:\s*/i, ''))
    } catch (cause) { setError(messageOf(cause)); setBusy(false) }
  }

  return { archiveSavedChat, deleteArchivedChat, renameWorkspaceChat, generateWorkspaceChatTitle }
}
