import type { WorkspaceChat } from '../chat/history/workspaceMemory'
import type { Session } from '../../types'
import type { CodexPrepareRequest } from './contracts'
import { expectedResponseBundleName } from '../artifacts/bundles/bundlename'
import { activePendingRequestId } from '../agent/runtime/pendingRequest'

type Bridge = WharnessDesktopBridge
type Prepared = Awaited<ReturnType<Bridge['chatgpt']['preparePrompt']>> & { alreadyDelivered?: boolean; alreadySupervised?: boolean }
export function preparePlannerPrompt(bridge: Bridge, chat: WorkspaceChat, request: CodexPrepareRequest): Promise<Prepared> {
  if (chat.engine !== 'codex') return bridge.chatgpt.preparePrompt(request)
  if (!bridge.codex) throw new Error('A integração Codex requer uma versão atualizada do Wharnex Desktop.')
  return bridge.codex.preparePrompt({ ...request, model: chat.codexModel })
}

export async function transportPlannerContinuation({ bridge, session, chat, artifacts, includeContext, request }: {
  bridge: Bridge; session: Session; chat: WorkspaceChat; artifacts: DesktopUserAttachment[]; includeContext: boolean
  request?: Pick<CodexPrepareRequest, 'cacheKey' | 'workspaceChatId' | 'background' | 'requestId' | 'reasoningEffort'>
}) {
  const text = session.last_manual_prompt || ''
  if (!text) throw new Error('Continuação do planner vazia.')
  const requestId = activePendingRequestId(session)
  const manualTransport = session.chat_transport_mode === 'manual'
  return preparePlannerPrompt(bridge, chat, {
    cacheKey: chat.id, workspaceChatId: chat.id,
    text, url: chat.chatgptUrl, sessionId: session.id, requestId,
    attachments: [], artifacts, autoSubmit: !manualTransport, manualTransport,
    expectedFilename: expectedResponseBundleName(text, requestId), projectFiles: [],
    contextSha256: session.context.workspace_sha256 || session.context.manifest.sha256,
    lastContextSha256: chat.lastContextSha256, lastContextChatgptUrl: chat.lastContextChatgptUrl,
    includeContext, preferCurrentConversation: false,
    chatTitle: chat.title, requestedAt: session.request_lineages?.[requestId]?.created_at || new Date().toISOString(),
    projectPath: session.project_path, reasoningEffort: session.reasoning_effort || 'high',
    ...request, background: !manualTransport,
  })
}
