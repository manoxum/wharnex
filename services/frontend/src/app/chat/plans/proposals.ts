import type { api } from '../../../lib/transport'
import { iterationRef } from '../transcriptMetadata'
import { errorMessage as messageOf } from '../../../lib/workspace'
import type { ChatItem, Session } from '../../../types'
import type { WorkspaceChat } from '../../../lib/chat'

type PlanProposalContext = {
  planAPI: Pick<typeof api, 'approvePlan' | 'correctPlan' | 'rejectPlan'>
  session?: Session
  chats: WorkspaceChat[]
  activeChatId: string
  activeChatIdRef: { current: string }
  setBusy: (value: boolean) => void
  setError: (value: string | undefined) => void
  acceptSessionForChat: (chat: WorkspaceChat, session: Session) => void
  setManualPrompt: (value: string) => void
  mutateChatItems: (chat: WorkspaceChat, projectPath: string, mutate: (items: ChatItem[]) => ChatItem[]) => void
  updateChat: (patch: Partial<WorkspaceChat>) => void
  transportPlannerContinuation: (session: Session, chat: WorkspaceChat) => Promise<{ submitted?: boolean; conversationUrl?: string }>
  appendChatItem: (chat: WorkspaceChat, projectPath: string, item: ChatItem) => void
}

export function createPlanProposalActions({
  planAPI, session, chats, activeChatId, activeChatIdRef, setBusy, setError,
  acceptSessionForChat, setManualPrompt, mutateChatItems, updateChat,
  transportPlannerContinuation, appendChatItem,
}: PlanProposalContext) {
  async function approvePlanProposal(item: ChatItem) {
    if (!session || !item.approval || item.approval.status !== 'pending') return
    const targetSession = session
    const active = chats.find((chat) => chat.id === activeChatId)
    if (!active) return
    setBusy(true); setError(undefined)
    let approvalCreated = false
    try {
      const response = await planAPI.approvePlan(targetSession.id, item.approval.requestId)
      approvalCreated = true
      acceptSessionForChat(active, response.session)
      if (activeChatIdRef.current === active.id) setManualPrompt(response.manual_prompt || response.session.last_manual_prompt || '')
      mutateChatItems(active, response.session.project_path, (current) => current.map((entry) => entry.id === item.id && entry.approval ? { ...entry, approval: { ...entry.approval, status: 'approved' } } : entry))
      updateChat({ pendingPlan: undefined, requestMode: 'direct' })
      if (response.session.last_manual_prompt) {
        const prepared = await transportPlannerContinuation(response.session, active)
        appendChatItem(active, response.session.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: prepared.submitted ? 'A aprovação foi enviada como continuação vinculada ao plano anterior.' : 'A continuação de aprovação foi preparada no ChatGPT.',
          meta: 'Plan approval · continuação vinculada',
          iteration: response.session.last_request_id ? iterationRef(response.session.last_request_id, prepared.submitted ? 'submitted' : 'prepared', ['prompt'], prepared.conversationUrl || active.chatgptUrl) : undefined,
        })
      } else {
        appendChatItem(active, response.session.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: 'A aprovação foi registada como continuação vinculada ao plano anterior. O prompt de implementação está preparado para envio manual.',
          meta: 'Plan approval · envio manual',
        })
      }
    } catch (cause) {
      setError(messageOf(cause))
      if (!approvalCreated) {
        mutateChatItems(active, targetSession.project_path, (current) => current.map((entry) => entry.id === item.id && entry.approval?.status === 'approved' ? { ...entry, approval: { ...entry.approval, status: 'pending' } } : entry))
      }
    } finally { setBusy(false) }
  }

  async function correctPlanProposal(item: ChatItem, guidance: string) {
    if (!session || !item.approval || item.approval.status !== 'pending') return
    const targetSession = session
    const active = chats.find((chat) => chat.id === activeChatId)
    if (!active) return
    setBusy(true); setError(undefined)
    let correctionCreated = false
    try {
      const response = await planAPI.correctPlan(targetSession.id, item.approval.requestId, guidance)
      correctionCreated = true
      acceptSessionForChat(active, response.session)
      if (activeChatIdRef.current === active.id) setManualPrompt(response.manual_prompt || response.session.last_manual_prompt || '')
      mutateChatItems(active, response.session.project_path, (current) => current.map((entry) => entry.id === item.id && entry.approval ? { ...entry, approval: { ...entry.approval, status: 'superseded' } } : entry))
      updateChat({ pendingPlan: { requestId: response.session.last_request_id || item.approval.requestId, originalMessage: item.approval.originalMessage }, requestMode: 'direct' })
      if (response.session.last_manual_prompt) {
        const prepared = await transportPlannerContinuation(response.session, active)
        appendChatItem(active, response.session.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: prepared.submitted ? 'A correção foi enviada como continuação vinculada ao plano anterior.' : 'A continuação de correção do plano foi preparada no ChatGPT.',
          meta: 'Plan correction · continuação vinculada',
          iteration: response.session.last_request_id ? iterationRef(response.session.last_request_id, prepared.submitted ? 'submitted' : 'prepared', ['prompt'], prepared.conversationUrl || active.chatgptUrl) : undefined,
        })
      } else {
        appendChatItem(active, response.session.project_path, {
          id: crypto.randomUUID(), role: 'harness', source: 'wharness', presentation: 'notice', createdAt: new Date().toISOString(),
          text: 'A correção foi registada como continuação vinculada ao plano anterior. O prompt para gerar a nova proposta está preparado para envio manual.',
          meta: 'Plan correction · envio manual',
        })
      }
    } catch (cause) {
      setError(messageOf(cause))
      if (!correctionCreated) {
        mutateChatItems(active, targetSession.project_path, (current) => current.map((entry) => entry.id === item.id && entry.approval?.status === 'superseded' ? { ...entry, approval: { ...entry.approval, status: 'pending' } } : entry))
      }
    } finally { setBusy(false) }
  }

  async function rejectPlanProposal(item: ChatItem) {
    if (!session || !item.approval || item.approval.status !== 'pending') return
    const targetSession = session
    const targetChat = chats.find((chat) => chat.id === activeChatId)
    if (!targetChat) return
    setBusy(true); setError(undefined)
    try {
      const updated = await planAPI.rejectPlan(targetSession.id, item.approval.requestId)
      acceptSessionForChat(targetChat, updated)
      mutateChatItems(targetChat, updated.project_path, (current) => current.map((entry) => entry.id === item.id && entry.approval ? { ...entry, approval: { ...entry.approval, status: 'rejected' } } : entry))
      updateChat({ pendingPlan: undefined, requestMode: 'direct' })
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  return { approvePlanProposal, correctPlanProposal, rejectPlanProposal }
}
