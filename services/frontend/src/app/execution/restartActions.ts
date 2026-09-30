import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ActivationImpact, ChatItem, Session } from '../../types'
import type { WorkspaceChat } from '../../lib/chat/history/workspaceMemory'
import type { RestartReport } from '../../lib/execution/recovery/restartConfirmation'
import { isRestartConfirmationReady } from '../../lib/execution/recovery/restartConfirmation'
import { buildAppliedChangeSummary } from './recoveryPresentation'
import { api } from '../../lib/transport/http/api'
import { desktopBridge } from '../../lib/desktop/bridge/desktop'
import { errorMessage as messageOf } from '../../lib/workspace/dialogs/errorMessage'

type RestartState = { chats: WorkspaceChat[]; sessions: Record<string, Session> }
type Params = {
  session?: Session
  chats: WorkspaceChat[]
  orchestratorRestart: RestartState
  activeChatId: string
  attentionSessions: Record<string, Session | undefined>
  sessionCacheRef: MutableRefObject<Record<string, Session>>
  restartReports: RestartReport[]
  busy: boolean
  setRestartReports: Dispatch<SetStateAction<RestartReport[]>>
  setRestartModalOpen: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | undefined>>
  setBusy: (value: boolean) => void
  acceptSessionForChat: (chat: WorkspaceChat, session: Session) => void
  appendChatItem: (chat: WorkspaceChat, projectPath: string, item: ChatItem) => void
}

export function createRestartActions({ session, chats, orchestratorRestart, activeChatId, attentionSessions, sessionCacheRef, restartReports, busy, setRestartReports, setRestartModalOpen, setError, setBusy, acceptSessionForChat, appendChatItem }: Params) {
  async function refreshRestartReports(focusChatId = '', openWhenReady = false) {
    if (!session) return [] as RestartReport[]
    const candidates = [...chats, ...orchestratorRestart.chats].filter((chat) => {
      const projected = chat.id === activeChatId && chat.sessionId === session.id ? session : attentionSessions[chat.id] || orchestratorRestart.sessions[chat.id]
      return chat.id === focusChatId || isRestartConfirmationReady(projected)
    })
    const reports = (await Promise.all(candidates.map(async (chat): Promise<RestartReport | undefined> => {
      const candidate = chat.id === activeChatId && chat.sessionId === session.id ? session : await api.getSession(chat.sessionId)
      sessionCacheRef.current[chat.id] = candidate
      if (!isRestartConfirmationReady(candidate)) return undefined
      return {
        sessionId: candidate.id,
        chatId: chat.id,
        chatTitle: chat.title,
        change: buildAppliedChangeSummary(candidate),
        impacts: candidate.self_evolution_impacts || [],
      } satisfies RestartReport
    }))).filter((report): report is RestartReport => Boolean(report))
    setRestartReports(reports)
    if (openWhenReady) setRestartModalOpen(reports.length > 0)
    else if (!reports.length) setRestartModalOpen(false)
    return reports
  }

  async function openRestartConfirmation(focusChatId = '') {
    setError(undefined)
    try {
      const reports = await refreshRestartReports(focusChatId, true)
      if (!reports.length) setError('O lote de auto-evolução já não está pendente de ativação.')
    } catch (reason) { setError(messageOf(reason)) }
  }

  function dismissRestartConfirmation() {
    setRestartModalOpen(false)
  }

  async function confirmSelfRestart(impacts: ActivationImpact[]) {
    if (!restartReports.length || busy) return
    const reports = [...restartReports]
    const targetReport = reports.find((report) => report.chatId === activeChatId) || reports[0]
    const targetChat = chats.find((chat) => chat.id === targetReport.chatId)
    // An Orchestrator task has no workspace chat; its session is activated the same way.
    if (!targetChat && !orchestratorRestart.chats.some((chat) => chat.id === targetReport.chatId)) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.restartSelfEvolution(targetReport.sessionId)
      const canonicalImpacts = updated.self_evolution_impacts?.length ? updated.self_evolution_impacts : impacts
      if (targetChat) acceptSessionForChat(targetChat, updated)
      setRestartModalOpen(false); setRestartReports([])
      await desktopBridge()?.windows.activateSelfEvolution(canonicalImpacts)
      const detail = canonicalImpacts.length ? canonicalImpacts.join(', ') : 'nenhum serviço em execução'
      for (const report of reports) {
        const chat = chats.find((candidate) => candidate.id === report.chatId)
        if (!chat) continue
        appendChatItem(chat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: `Ativação conjunta confirmada para: ${detail}. O supervisor transacional ativa uma única vez a união dos componentes afetados e restaura automaticamente a versão anterior se a ativação falhar.`, meta: 'AUTO-EVOLUÇÃO · lote ativado' })
      }
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  return { refreshRestartReports, openRestartConfirmation, dismissRestartConfirmation, confirmSelfRestart }
}
