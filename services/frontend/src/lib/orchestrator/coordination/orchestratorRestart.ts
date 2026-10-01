import type { AttentionRecord, Session } from '../../../types'
import { isRestartPending } from '../../execution/recovery/restartConfirmation'
import type { WorkspaceChat } from '../../chat/history/workspaceMemory'

// An Orchestrator task's Agent Session carries a chat id derived from the
// task id, but is not a workspace chat. A self-evolution task that reached
// REVIEW leaves that session in restart_pending exactly like an agentic chat;
// projecting it as a chat lets the same attention, notification and activation
// flow offer the restart.
const ORCHESTRATOR_TASK_CHAT_PREFIX = 'otk-'

export function orchestratorRestartChats(
  records: AttentionRecord[],
  chats: WorkspaceChat[],
  toSession: (record: AttentionRecord) => Session,
): { chats: WorkspaceChat[]; sessions: Record<string, Session> } {
  const known = new Set(chats.map((chat) => chat.sessionId))
  // Every run or retry of a task opens its own Agent Session under the same
  // chat id; the one applied most recently stands for the task.
  const latest = new Map<string, { record: AttentionRecord; session: Session }>()
  for (const record of records) {
    if (!record.chat_id.startsWith(ORCHESTRATOR_TASK_CHAT_PREFIX) || known.has(record.session_id)) continue
    const session = toSession(record)
    if (!isRestartPending(session)) continue
    const current = latest.get(record.chat_id)
    if (current && String(current.record.last_host_applied_at || '') >= String(record.last_host_applied_at || '')) continue
    latest.set(record.chat_id, { record, session })
  }
  const result: { chats: WorkspaceChat[]; sessions: Record<string, Session> } = { chats: [], sessions: {} }
  for (const { record, session } of latest.values()) {
    const title = record.last_turn?.chat_title?.trim() || record.chat_id
    result.chats.push({ id: record.chat_id, title: `Orchestrator · ${title}`, sessionId: record.session_id, purpose: 'self-evolution', createdAt: '', updatedAt: '' })
    result.sessions[record.chat_id] = session
  }
  return result
}
