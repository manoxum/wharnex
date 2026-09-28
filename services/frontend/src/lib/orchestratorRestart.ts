import type { AttentionRecord, Session } from '../types'
import { isRestartPending } from './restartConfirmation'
import type { WorkspaceChat } from './workspaceMemory'

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
  const result: { chats: WorkspaceChat[]; sessions: Record<string, Session> } = { chats: [], sessions: {} }
  for (const record of records) {
    if (!record.chat_id.startsWith(ORCHESTRATOR_TASK_CHAT_PREFIX) || known.has(record.session_id)) continue
    const session = toSession(record)
    if (!isRestartPending(session)) continue
    const title = record.last_turn?.chat_title?.trim() || record.chat_id
    result.chats.push({ id: record.chat_id, title: `Orchestrator · ${title}`, sessionId: record.session_id, purpose: 'self-evolution', createdAt: '', updatedAt: '' })
    result.sessions[record.chat_id] = session
  }
  return result
}
