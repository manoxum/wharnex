import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AutomationMode, ChatItem, EffortLevel, ExecutionMode, HarnessEvent, Session } from '../../types'
import type { PromptDeliveryFailureKind } from '../../lib/chat/transport/chatgptPromptDelivery'
import type { LiveEventStream } from '../../lib/transport/http/liveEventStream'
import type { ExecutionFIFOItem } from '../../lib/execution/history/executionQueueView'
import { api, APIError } from '../../lib/transport/http/api'
import { desktopBridge } from '../../lib/desktop/bridge/desktop'
import { archiveChat as archiveStoredChat, durableWorkspaceChat, saveArchivedWorkspaceChats, saveChatForLater as saveStoredChatForLater, saveWorkspaceChats, type RemoteArchive, type WorkspaceChat } from '../../lib/chat/history/workspaceMemory'
import { errorMessage as messageOf } from '../../lib/workspace/dialogs/errorMessage'
import { hydrateChatTranscript } from './workspaceHydration'
import { welcomeItem } from './transcriptMetadata'

type Setter<T> = Dispatch<SetStateAction<T>>
type Params = {
  session?: Session
  busy: boolean
  chats: WorkspaceChat[]
  activeChatId: string
  executionMode: ExecutionMode
  automationMode: AutomationMode
  effortLevel: EffortLevel
  resumedBundleKeysRef: MutableRefObject<Set<string>>
  sessionCacheRef: MutableRefObject<Record<string, Session>>
  activeChatIdRef: MutableRefObject<string>
  transcriptReadyRef: MutableRefObject<Set<string>>
  sourceRef: MutableRefObject<LiveEventStream | null>
  setBusy: (value: boolean) => void
  setError: Setter<string | undefined>
  setArchivedChats: Setter<WorkspaceChat[]>
  setSavedChats: Setter<WorkspaceChat[]>
  setChats: Setter<WorkspaceChat[]>
  setExecutionFIFO: Setter<ExecutionFIFOItem[]>
  setPreparedDrafts: Setter<Record<string, number>>
  setFailedPromptDeliveries: Setter<Record<string, { kind: PromptDeliveryFailureKind; requestId: string }>>
  persistChats: (projectPath: string, chats: WorkspaceChat[]) => void
  setActiveChatId: Setter<string>
  setEvents: Setter<HarnessEvent[]>
  setItems: Setter<ChatItem[]>
  setManualPrompt: Setter<string>
  setSession: Setter<Session | undefined>
  syncSessionModes: (session: Session, executionMode: ExecutionMode, automationMode: AutomationMode) => Promise<Session>
  connectEvents: (id: string, projectPath: string, chatId: string) => void
}

export function createActiveChatLifecycleActions({ session, busy, chats, activeChatId, executionMode, automationMode, effortLevel, resumedBundleKeysRef, sessionCacheRef, activeChatIdRef, transcriptReadyRef, sourceRef, setBusy, setError, setArchivedChats, setSavedChats, setChats, setExecutionFIFO, setPreparedDrafts, setFailedPromptDeliveries, persistChats, setActiveChatId, setEvents, setItems, setManualPrompt, setSession, syncSessionModes, connectEvents }: Params) {
  async function archiveChat(chatId: string) {
    if (!session || busy) return
    const target = chats.find((chat) => chat.id === chatId)
    if (!target) return

    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      const bridge = desktopBridge()
      // Local close is authoritative and completes before any remote account
      // work. Remote archive is represented only by a durable worker task;
      // the visible Supervisor is never resurrected or navigated for it.
      let remoteArchive: RemoteArchive = bridge && target.chatgptUrl
        ? { state: 'pending', attempts: 0, lastState: 'queue-pending' }
        : { state: 'not-applicable', attempts: 0 }
      const moved = archiveStoredChat(projectPath, chatId, remoteArchive)
      setArchivedChats(moved.archived)
      setExecutionFIFO((current) => current.filter((item) => item.chatId !== chatId))
      if (bridge && target.chatgptUrl) {
        try {
          const queued = await bridge.chatgpt.queueArchive({ cacheKey: chatId, url: target.chatgptUrl, sessionId: target.sessionId, projectId: projectPath })
          remoteArchive = { state: 'pending', attempts: 0, lastState: queued.state, lastAttemptAt: new Date().toISOString() }
        } catch (cause) {
          remoteArchive = { state: 'pending', attempts: 0, lastState: `queue-error: ${messageOf(cause).slice(0, 180)}`, lastAttemptAt: new Date().toISOString() }
        }
        moved.archived = moved.archived.map((chat) => chat.id === chatId ? { ...chat, remoteArchive } : chat)
        saveArchivedWorkspaceChats(projectPath, moved.archived)
        setArchivedChats(moved.archived)
      }
      // The durable chat row has to learn about the archive too. It used to
      // learn only about the session, so on the next restart the durable
      // record — which wins the hydration merge — still said "active" and
      // every chat archived since it became durable reopened.
      try { await api.setWorkspaceChatArchived(chatId, true) } catch { /* retried on the next archive/restore */ }
      // Best-effort: the local transcript archive above stays authoritative
      // and is never blocked on this. It only gives the backend a trigger
      // to eventually compact this session's own artifacts/logs (ADR-0031).
      try { await api.archiveChat(target.sessionId) } catch { /* backend archive state will simply lag; retried on next archive/restore */ }
      const remoteKeys = [chatId]
      await Promise.allSettled(remoteKeys.map((cacheKey) => bridge?.chatgpt.release(cacheKey)))
      for (const key of [...resumedBundleKeysRef.current]) if (key.startsWith(`${target.sessionId}:`) || remoteKeys.some((cacheKey) => key.endsWith(`:${cacheKey}`))) resumedBundleKeysRef.current.delete(key)
      setArchivedChats(moved.archived)
      delete sessionCacheRef.current[chatId]
      setPreparedDrafts((current) => { const next = { ...current }; delete next[chatId]; return next })
      setFailedPromptDeliveries((current) => { const next = { ...current }; delete next[chatId]; return next })
      if (chatId !== activeChatId) {
        setChats(moved.active)
        return
      }

      sourceRef.current?.close(); sourceRef.current = null
      let nextChats = moved.active
      let nextChat = nextChats[0]
      if (!nextChat) {
        // Closing the last open chat is a valid end state: the workspace
        // stays on this project (its session is retained only for
        // project_path, so "Novo chat" can still create a fresh session) but
        // shows no active chat, instead of silently recreating one.
        persistChats(projectPath, [])
        activeChatIdRef.current = ''; setActiveChatId(''); setEvents([]); setItems([]); setManualPrompt('')
        return
      }
      let restored: Session
      try {
        restored = await api.getSession(nextChat.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(projectPath, executionMode, automationMode, undefined, effortLevel)
        nextChat = { ...nextChat, sessionId: restored.id, updatedAt: new Date().toISOString() }
        nextChats = nextChats.map((chat) => chat.id === nextChat!.id ? nextChat! : chat)
      }

      const chatItems = await hydrateChatTranscript(projectPath, nextChat.id)
      transcriptReadyRef.current.add(nextChat.id)
      persistChats(projectPath, nextChats)
      activeChatIdRef.current = nextChat.id; setActiveChatId(nextChat.id); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || '')
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, nextChat.id)
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function saveChatForLater(chatId: string) {
    if (!session || busy) return false
    const target = chats.find((chat) => chat.id === chatId)
    if (!target) return false
    setBusy(true); setError(undefined)
    try {
      const projectPath = session.project_path
      await api.saveWorkspaceChat(durableWorkspaceChat(projectPath, target))
      await api.setWorkspaceChatSaved(chatId, true)
      const moved = saveStoredChatForLater(projectPath, chatId)
      setSavedChats(moved.saved)
      setExecutionFIFO((current) => current.filter((item) => item.chatId !== chatId))
      try { await desktopBridge()?.chatgpt.release?.(chatId) } catch { /* saving never mutates the remote conversation */ }
      if (chatId !== activeChatId) {
        setChats(moved.active)
        return true
      }

      sourceRef.current?.close(); sourceRef.current = null
      let nextChats = moved.active
      let nextChat = nextChats[0]
      setChats(nextChats)
      if (!nextChat) {
        activeChatIdRef.current = ''; setActiveChatId(''); setEvents([]); setItems([]); setManualPrompt('')
        return true
      }
      let restored: Session
      try {
        restored = await api.getSession(nextChat.sessionId)
        restored = await syncSessionModes(restored, executionMode, automationMode)
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error
        restored = await api.createSession(projectPath, executionMode, automationMode, undefined, effortLevel)
        nextChat = { ...nextChat, sessionId: restored.id, updatedAt: new Date().toISOString() }
        nextChats = nextChats.map((chat) => chat.id === nextChat!.id ? nextChat! : chat)
        saveWorkspaceChats(projectPath, nextChats); setChats(nextChats)
      }
      const chatItems = await hydrateChatTranscript(projectPath, nextChat.id)
      transcriptReadyRef.current.add(nextChat.id)
      activeChatIdRef.current = nextChat.id; setActiveChatId(nextChat.id); setSession(restored); setEvents([])
      setManualPrompt(restored.last_manual_prompt || '')
      setItems(chatItems.length ? chatItems : [welcomeItem(restored)])
      connectEvents(restored.id, restored.project_path, nextChat.id)
      return true
    } catch (e) { setError(messageOf(e)); return false } finally { setBusy(false) }
  }

  return { archiveChat, saveChatForLater }
}
