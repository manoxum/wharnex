import type { Session, ChatGPTActivity } from '../../../../types'
import type { WorkspaceChat } from '../../../../lib/chat/history/workspaceMemory'
import { activePendingRequestId } from '../../../../lib/agent/runtime/pendingRequest'
import { ChatGPTDesktopPane } from '../../../chatgpt/surface/ChatGPTDesktopPane'
import { lazy, Suspense } from 'react'
const CodexPanel = lazy(() => import('../../../codex/surface').then((m) => ({ default: m.CodexPanel })))

// The renderer exposes exactly one human-facing Supervisor pane. Background
// automation is owned by the Desktop process' three hidden worker browsers and
// the durable backend queue, so React must not keep a pane mounted per chat.
// Re-rendering the same component with another chat id preserves one Supervisor
// surface while Desktop coalesces navigation around submit/write critical phases.
export function InspectorEngineSurface({ visible, globallySuspended, activeChat, chatgptUrl, busy, session, manualPrompt, onChatGPTURL, onChatGPTActivity, onTransportFailure, onCancelPendingRequest, onResendPendingRequest, onPlanFile, onBundleFile }: {
  visible: boolean
  globallySuspended: boolean
  activeChat: WorkspaceChat
  chatgptUrl?: string
  busy: boolean
  session: Session
  manualPrompt: string
  onChatGPTURL: (url: string) => boolean
  onChatGPTActivity?: (activity: ChatGPTActivity) => void
  onTransportFailure?: (requestId: string, reason: string) => void
  onCancelPendingRequest?: (requestId: string) => Promise<void>
  onResendPendingRequest?: (requestId: string) => Promise<void>
  onPlanFile: (json: string, requestId: string) => Promise<string>
  onBundleFile: (contentBase64: string, requestId: string, filename: string) => Promise<string>
}) {
  if (activeChat.engine === 'codex') return visible && !globallySuspended ? <Suspense fallback={null}><CodexPanel projectPath={session.project_path} chatId={activeChat.id}/></Suspense> : null
  return <div className="desktop-chatgpt-pool" hidden={!visible}>
    <div className="desktop-chatgpt-pool-item active">
      <ChatGPTDesktopPane
        suspended={globallySuspended || !visible}
        busy={busy}
        chatId={activeChat.id}
        chatTitle={activeChat.title}
        chatgptUrl={chatgptUrl}
        pendingRequestId={activePendingRequestId(session)}
        sessionId={session.id}
        chatHash={session.context.workspace_sha256 || session.context.manifest.sha256}
        requestedAt={session.request_lineages?.[activePendingRequestId(session)]?.created_at || session.created_at}
        recoveryBootstrap={session.last_manual_prompt}
        transportMode={session.chat_transport_mode || 'scraper'}
        manualPrompt={manualPrompt}
        onChatGPTURL={onChatGPTURL}
        onActivity={onChatGPTActivity}
        onTransportFailure={onTransportFailure}
        onCancelPendingRequest={onCancelPendingRequest}
        onResendPendingRequest={onResendPendingRequest}
        onPlanFile={onPlanFile}
        onBundleFile={onBundleFile}
      />
    </div>
  </div>
}

