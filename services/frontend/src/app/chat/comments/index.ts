import type { ChatItem, Session } from '../../../types'
import type { WorkspaceChat } from '../../../lib/chat/history/workspaceMemory'
import type { CodexBridge, CodexThread } from '../../../lib/codex'
import type { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { encodeChatAttachments } from '../../../lib/chat'
import { activePendingRequestId } from '../../../lib/agent'
import { iterationRef } from '../transcriptMetadata'

type CommentBridge = { codex?: Pick<CodexBridge, 'steerNative'>; chatgpt: Pick<NonNullable<ReturnType<typeof desktopBridge>>['chatgpt'], 'queueComment'> }

export async function sendTaskComment(bridge: CommentBridge, session: Session, chat: WorkspaceChat, native: CodexThread | undefined, message: string, attachments: File[]): Promise<ChatItem> {
  const requestId = chat.engine === 'codex' ? native?.requestId : activePendingRequestId(session) || chat.pendingPlan?.requestId
  if (!requestId) throw new Error('Nenhuma tarefa ativa para comentar.')
  const encoded = attachments.length ? await encodeChatAttachments(attachments) : []
  const commentId = crypto.randomUUID()
  let queued = false
  if (chat.engine === 'codex') {
    if (!native?.native || native.chatId !== chat.id || native.projectPath !== session.project_path || !['running', 'waiting'].includes(native.status)) throw new Error('Nenhum turno Codex ativo para esta instrução.')
    if (!bridge.codex?.steerNative) throw new Error('Atualize o Wharnex Desktop para enviar instruções incrementais ao Codex.')
    const result = await bridge.codex.steerNative(session.project_path, chat.id, requestId, commentId, message, encoded)
    if (!result.ok) throw new Error('O Codex não confirmou a instrução incremental.')
  } else {
    const result = await bridge.chatgpt.queueComment({ cacheKey: chat.id, sessionId: session.id, text: message, url: chat.chatgptUrl, requestId, commentId, attachments: encoded, reasoningEffort: session.reasoning_effort || 'high' })
    queued = result.queued
  }
  return { id: commentId, role: 'user', source: 'user', text: message, createdAt: new Date().toISOString(),
    meta: `${chat.engine === 'codex' ? 'Instrução enviada ao Codex' : queued ? 'Comentário em fila para a tarefa ativa' : 'Comentário enviado para a tarefa ativa'}${attachments.length ? ` · ${attachments.length} anexo(s)` : ''}`,
    iteration: iterationRef(requestId, 'submitted', ['prompt'], chat.engine === 'codex' ? undefined : chat.chatgptUrl) }
}
