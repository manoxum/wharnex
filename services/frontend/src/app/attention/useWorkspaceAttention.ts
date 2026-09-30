import { useEffect, useState } from 'react'
import { api } from '../../lib/transport/http/api'
import type { OrchestratorTaskConclusion, Session } from '../../types'
import type { WorkspaceChat } from '../../lib/chat/history/workspaceMemory'
import { normalizeWorkspaceAttentionPayload } from '../../lib/orchestrator/coordination/orchestratorAttention'
import { orchestratorRestartChats } from '../../lib/orchestrator/coordination/orchestratorRestart'
import { attentionSessionFrom } from './attentionSession'

const ATTENTION_REFRESH_INTERVAL_MS = 15_000

type Params = {
  session?: Session
  chats: WorkspaceChat[]
  activeChatId: string
  activeChatOwnsSession: boolean
  setOrchestratorRestart: (value: { chats: WorkspaceChat[]; sessions: Record<string, Session> }) => void
}

export function useWorkspaceAttention({ session, chats, activeChatId, activeChatOwnsSession, setOrchestratorRestart }: Params) {
  const [attentionSessions, setAttentionSessions] = useState<Record<string, Session | undefined>>({})
  const [orchestratorConclusionState, setOrchestratorConclusionState] = useState<{ projectPath: string; items: OrchestratorTaskConclusion[] }>({ projectPath: '', items: [] })
  useEffect(() => {
    if (!session || !activeChatOwnsSession || !activeChatId) return
    setAttentionSessions((current) => current[activeChatId] === session ? current : { ...current, [activeChatId]: session })
  }, [activeChatId, activeChatOwnsSession, session])

  useEffect(() => {
    if (!session) {
      setAttentionSessions({})
      setOrchestratorConclusionState({ projectPath: '', items: [] })
      return
    }
    let cancelled = false
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        // One compact request for the whole project, not one full Session per
        // chat. Those payloads are 1-2 MB each (context manifests, pending
        // patches, artifact inventories), so a workspace with many chats pulled
        // and parsed tens of megabytes per poll — enough to block the
        // renderer's main thread until the window was killed and restarted.
        let snapshot: ReturnType<typeof normalizeWorkspaceAttentionPayload>
        try { snapshot = normalizeWorkspaceAttentionPayload(await api.workspaceAttention(session.project_path)) }
        catch { return }
        if (cancelled) return
        const bySession = new Map(snapshot.records.map((record) => [record.session_id, record]))
        const entries = chats.map((chat) => {
          if (chat.id === activeChatId && chat.sessionId === session.id) return [chat.id, session] as const
          const record = bySession.get(chat.sessionId)
          return [chat.id, record ? attentionSessionFrom(record, session.project_path) : undefined] as const
        })
        if (!cancelled) {
          setAttentionSessions(Object.fromEntries(entries))
          setOrchestratorConclusionState({ projectPath: session.project_path, items: snapshot.orchestratorConclusions })
          setOrchestratorRestart(orchestratorRestartChats(snapshot.records, chats, (record) => attentionSessionFrom(record, session.project_path)))
        }
      } finally { refreshing = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), ATTENTION_REFRESH_INTERVAL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [activeChatId, chats, session])

  return { attentionSessions, orchestratorConclusionState }
}
