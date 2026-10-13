import type { Session } from '../../types'
import type { WorkspaceChat } from '../chat/history/workspaceMemory'
import { activePendingRequestId } from '../agent/runtime/pendingRequest'

export async function recoverCodexContinuation(bridge: WharnessDesktopBridge, session: Session, chat: WorkspaceChat, dispatch: () => Promise<unknown>) {
  if (chat.engine !== 'codex' || !bridge.codex) return false
  const requestId = activePendingRequestId(session)
  if (!requestId) return false
  const threads = await bridge.codex.threads(session.project_path)
  const record = threads.find((item) => item.chatId === chat.id)
  // Uncertain or already submitted requests need observation/human recovery,
  // never another provider submission. A cancelled request stays cancelled.
  if (record && (record.status !== 'idle' || record.requestId === requestId)) return false
  await dispatch()
  return true
}
