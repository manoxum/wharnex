import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ChatItem, ChatTransportMode, ContextMode, ReasoningEffort, Session } from '../../types'
import type { WorkspaceChat } from '../../lib/chat/history/workspaceMemory'
import { api } from '../../lib/transport/http/api'
import { desktopBridge, isDesktop } from '../../lib/desktop/bridge/desktop'
import { errorMessage as messageOf } from '../../lib/workspace/dialogs/errorMessage'

type Params = {
  session?: Session
  busy: boolean
  chats: WorkspaceChat[]
  activeChatId: string
  activeChatIdRef: MutableRefObject<string>
  chatTransportMode: ChatTransportMode
  setBusy: (value: boolean) => void
  setError: Dispatch<SetStateAction<string | undefined>>
  setChatTransportMode: Dispatch<SetStateAction<ChatTransportMode>>
  acceptSessionForChat: (chat: WorkspaceChat, session: Session) => void
  appendChatItem: (chat: WorkspaceChat, projectPath: string, item: ChatItem) => void
  transportPlannerContinuation: (session: Session, chat: WorkspaceChat) => Promise<unknown>
}

export function createChatSessionActions({ session, busy, chats, activeChatId, activeChatIdRef, chatTransportMode, setBusy, setError, setChatTransportMode, acceptSessionForChat, appendChatItem, transportPlannerContinuation }: Params) {
  // Provider reasoning is a per-chat choice. It is separate from EffortLevel,
  // which remains the project-wide ceiling for autonomous retry rounds.
  async function changeReasoningEffort(next: ReasoningEffort) {
    if (!session || next === (session.reasoning_effort || 'high') || busy) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.setReasoningEffort(session.id, next)
      acceptSessionForChat(targetChat, updated)
    } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }

  async function changeContextMode(next: ContextMode) {
    if (!session || next === (session.context_mode || 'full') || busy) return
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      acceptSessionForChat(targetChat, await api.setContextMode(session.id, next))
    } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }

  // Chat transport is genuinely per-chat: it only decides whether THIS chat's
  // Desktop DOM automation runs, so switching it must never touch peer sessions.
  async function changeChatTransportMode(next: ChatTransportMode) {
    if (!session || next === chatTransportMode || busy) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.setChatTransportMode(targetSession.id, next)
      acceptSessionForChat(targetChat, updated)
      if (activeChatIdRef.current === targetChat.id) setChatTransportMode(next)
      if (isDesktop()) { try { await desktopBridge()?.chatgpt.setTransportMode(targetChat.id, next) } catch { /* best-effort transport sync; Desktop also honors manualTransport on prepared requests */ } }
      appendChatItem(targetChat, updated.project_path, { id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(), text: next === 'manual' ? 'Modo Manual ativado para este chat. O Wharnex deixa de interagir com o ChatGPT — copie o prompt e entregue o bundle de resposta manualmente.' : 'Modo Scraper ativado para este chat. O Wharnex volta a interagir diretamente com o ChatGPT.', meta: next === 'manual' ? 'Manual' : 'Scraper' })
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function changeKnowledgeSharing(enabled: boolean) {
    if (!session || busy || (session.knowledge_sharing_enabled !== false) === enabled) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.setKnowledgeSharing(targetSession.id, enabled)
      acceptSessionForChat(targetChat, updated)
      appendChatItem(targetChat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: enabled
          ? 'Conhecimento do projeto ligado para este chat. O próximo pedido incluirá o catálogo incremental atual em ficheiros separados.'
          : 'Conhecimento do projeto desligado para este chat. O catálogo existente deixa de ser enviado até reativação ou até existir uma revisão mais recente criada por outro chat.',
        meta: enabled ? 'Conhecimento ligado' : 'Conhecimento desligado',
      })
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  async function changeDebugMode(enabled: boolean) {
    if (!session || busy || Boolean(session.debug_enabled) === enabled) return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await api.setDebugMode(targetSession.id, enabled)
      acceptSessionForChat(targetChat, updated)
      appendChatItem(targetChat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: enabled
          ? 'Modo Debug ligado. Probes de observação validados podem executar automaticamente; qualquer alteração no host, rede ou instalação de ferramenta continua a exigir aprovação dedicada do plano.'
          : 'Modo Debug desligado. O primeiro probe de cada Main Request voltará a pedir uma autorização única.',
        meta: enabled ? 'Debug ligado' : 'Debug sob autorização',
      })
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  async function approveDebug() {
    if (!session?.plan?.debug || session.state !== 'debug_approval_required' || busy) return
    const targetSession = session
    const debugTarget = session.plan.debug.target
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const submission = await api.approveDebug(targetSession.id)
      const updated = submission.session
      acceptSessionForChat(targetChat, updated)
      const modifiesHost = session.plan.debug.target === 'host' && session.plan.debug.access === 'modify'
      appendChatItem(targetChat, updated.project_path, {
        id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
        text: modifiesHost
          ? 'Ação de debug no host autorizada somente para este plano. Uma continuação que volte a alterar o host terá de apresentar e aprovar um novo plano.'
          : 'Debug autorizado para esta Main Request. Os próximos probes de observação compatíveis do mesmo fluxo seguem automaticamente.',
        meta: `Debug · ${debugTarget}`,
      })
      if (submission.workflow_prepared && updated.last_manual_prompt) await transportPlannerContinuation(updated, targetChat)
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  return { changeReasoningEffort, changeContextMode, changeChatTransportMode, changeKnowledgeSharing, changeDebugMode, approveDebug }
}
