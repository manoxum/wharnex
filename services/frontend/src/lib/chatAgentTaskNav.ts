import type { ChatAgentTask } from '../types'

// Shared by the Tarefas drawer and the Orchestrator planning queue so a task
// only ever offers navigation it can actually resolve, from the exact same
// durable identifiers, in exactly one place.

export type ChatAgentTaskChatRef = { id: string; sessionId: string }

export function extractWorkerId(owner?: string) {
  const match = String(owner || '').trim().match(/(?:^|:)(worker-\d+)$/)
  return match?.[1]
}

const EPHEMERAL_TASK_TYPES = new Set(['ORCHESTRATOR_PLAN', 'RELEASE_NOTES', 'TRANSLATE_MARKDOWN'])

// The browser serving a leased task. Planning, release notes and translation
// run on an ephemeral browser named after the task itself; its lease owner is
// the ephemeral pool's loop (translator-N), not a Worker slot.
export function taskBrowserAgentId(task?: { task_id: string; type: string; status: string; lease_owner?: string }) {
  if (!task || !['LEASED', 'RUNNING'].includes(task.status)) return undefined
  if (EPHEMERAL_TASK_TYPES.has(task.type) && /(?:^|:)translator-\d+$/.test(String(task.lease_owner || '').trim())) {
    return `${task.type === 'TRANSLATE_MARKDOWN' ? 'translator' : 'ephemeral'}-${task.task_id}`
  }
  return extractWorkerId(task.lease_owner)
}

// A task's chat_id is the real Harness chat id for ordinary work, but is the
// synthetic orchestrator request id for ORCHESTRATOR_PLAN tasks; session_id
// resolves either shape to the real owning chat.
export function resolveTaskChatId(task: Pick<ChatAgentTask, 'chat_id' | 'session_id'>, chats: ChatAgentTaskChatRef[]) {
  if (task.chat_id && chats.some((chat) => chat.id === task.chat_id)) return task.chat_id
  if (task.session_id) return chats.find((chat) => chat.sessionId === task.session_id)?.id
  return undefined
}
