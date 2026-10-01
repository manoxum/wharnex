import type { ComponentProps } from 'react'
import type { ChatAgentTaskChatRef } from '../../../lib/chat/transport/chatAgentTaskNav'
import type { Session } from '../../../types'
import type { ChatPanel } from '../../chat/panel/ChatPanel'

export type OrchestratorWorkspaceProps = {
  session: Session
  // Minimal id/sessionId pairs only: enough to resolve a planning request's
  // owning Harness chat without threading the full workspace-chat record in.
  chats?: ChatAgentTaskChatRef[]
  chatProps: ComponentProps<typeof ChatPanel>
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  // Bumped by the Tarefas drawer's "Ver orquestração" action so a task that
  // sent the operator here always lands back on the planning queue instead of
  // whichever section Orchestrator happened to be left on.
  focusNonce?: number
  // A completion notification targets the durable Orchestrator task directly;
  // it must not rely on the synthetic execution chat id used by Workers.
  focusTaskId?: string
  focusTaskNonce?: number
  // This workspace stays mounted (CSS-hidden) while another mode is active,
  // the same way EditorWorkspace does, so its local state (section, selected
  // task) survives switching away and back. Polling every 5s regardless kept
  // a network+render cost running forever for a panel the operator was not
  // looking at; only poll while it is actually the visible mode.
  active?: boolean
  bootstrapObjective?: string
  bootstrapIncludeContext?: boolean
  onBootstrapAccepted?: () => void
  onError: (message?: string) => void
}
