import type { ChatAgentTask } from '../types'
import { request } from './api'

export type RemotePromptRequest = Record<string, unknown> & {
  text: string
  requestId: string
  sessionId: string
  workspaceChatId: string
  includeContext?: boolean
  url?: string
}

export type RemotePromptDispatch = {
  queued: true
  taskId: string
  attachmentCount: number
  submitted: true
  includedContext: boolean
  conversationUrl?: string
}

export async function queueRemotePrompt(input: {
  chatId: string
  sessionId: string
  requestId: string
  projectPath: string
  conversationUrl?: string
  prompt: RemotePromptRequest
}): Promise<RemotePromptDispatch> {
  const task = await request<ChatAgentTask>('/api/chat-agent/tasks', {
    method: 'POST',
    body: JSON.stringify({
      type: 'BOT_WRITE',
      chat_id: input.chatId,
      session_id: input.sessionId,
      request_id: input.requestId,
      root_request_id: input.requestId,
      project_id: input.projectPath,
      dedupe_key: `prepare:${input.requestId}`,
      max_attempts: 6,
      not_before: new Date().toISOString(),
      payload: { operation: 'PREPARE_PROMPT', workspace_chat_id: input.chatId, request: input.prompt },
    }),
  })
  return {
    queued: true,
    taskId: task.task_id,
    attachmentCount: 1,
    submitted: true,
    includedContext: input.prompt.includeContext === true,
    conversationUrl: input.conversationUrl || undefined,
  }
}
