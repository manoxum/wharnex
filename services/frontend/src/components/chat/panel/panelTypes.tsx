import type { ReactNode } from 'react'
import type { CodexPermissionLevel, PlannerChatConfiguration, PlannerEngine } from '../../../lib/codex'
import type { AutomationMode, EffortLevel, ArtifactRecord, ChatArtifactKind, ChatArtifactSelection, ChatItem, ChatRequestMode, ChatTransportMode, ExecutionMode, ExecutionPlan, QueuedChatRequest, Session } from '../../../types'
import type { ContextMode, ReasoningEffort } from '../../../types'
import { type WorkspaceChat } from '../../../lib/chat/history/workspaceMemory'
import { type ComposerRichEditorHandle } from '../composer/ComposerRichEditor'
import { type ChatViewportStore } from './useProgressiveChatHistory'

/**
 * An imperative escape hatch onto the composer's rich editor — chiefly for
 * tests that need to drive it directly (see ChatPanel.test.tsx): jsdom cannot
 * faithfully simulate real keystrokes into a contenteditable Quill instance,
 * so tests instead call the underlying Quill API through here, exactly the
 * same way flowdocs' own editor keeps a `getEditor()` escape hatch for its
 * own imperative chip operations.
 */
export type ChatPanelHandle = { getComposerEditor: () => ReturnType<ComposerRichEditorHandle['getEditor']>; prepareExecutionPlanAdjustment: (plan: ExecutionPlan) => void }

export type ChatPanelProps = PlannerChatConfiguration & {
  onEngine?: (engine: PlannerEngine) => void
  onCodexModel?: (model: string) => void
  onCodexEffort?: (effort: string) => void
  onCodexPermission?: (level: CodexPermissionLevel) => void
  session: Session
  items: ChatItem[]
  chats: WorkspaceChat[]
  archivedChats: WorkspaceChat[]
  activeChatId: string
  busy: boolean
  embedded?: boolean
  hideSwitcher?: boolean
  composerOnly?: boolean
  compactComposer?: boolean
  composerPlaceholder?: string
  composerSendLabel?: string
  executionApproval?: ReactNode
  composerHint?: string
  historyViewportStore?: ChatViewportStore
  executionMode?: ExecutionMode
  automationMode?: AutomationMode
  effortLevel?: EffortLevel
  reasoningEffort?: ReasoningEffort
  chatTransportMode?: ChatTransportMode
  attachmentsEnabled?: boolean
  preparedAttachmentCount?: number
  failedPromptDelivery?: { kind: 'retry' | 'attention' | 'storage'; requestId: string }
  artifactSelection?: ChatArtifactSelection
  artifactRequired?: Partial<Record<ChatArtifactKind, boolean>>
  artifactContent?: Partial<Record<ChatArtifactKind, string>>
  requestMode?: ChatRequestMode
  taskInFlight?: boolean
  queuedRequests?: QueuedChatRequest[]
  transportProgress?: string
  transportRequestId?: string
  onExecutionMode?: (mode: ExecutionMode) => void
  onAutomationMode?: (mode: AutomationMode) => void
  onDebugMode?: (enabled: boolean) => void
  onEffortLevel?: (level: EffortLevel) => void
  onReasoningEffort?: (effort: ReasoningEffort) => void
  onContextMode?: (mode: ContextMode) => void
  onChatTransportMode?: (mode: ChatTransportMode) => void
  onKnowledgeSharing?: (enabled: boolean) => void
  onToggleArtifact?: (kind: ChatArtifactKind) => void
  onRequestMode?: (mode: ChatRequestMode) => void
  onComposerTyping?: () => void
  onSend: (message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode) => Promise<void>
  onAdjustExecutionPlan?: (message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection) => Promise<void>
  onPreviewBundle?: (message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode) => Promise<ArtifactRecord>
  onComment?: (message: string, attachments: File[]) => Promise<void>
  onQueueEdit?: (id: string, message: string) => void
  onQueueMove?: (id: string, direction: -1 | 1) => void
  onQueueRemove?: (id: string) => void
  onQueueMerge?: (id: string) => void
  onQueuePromote?: (id: string) => Promise<void>
  onApprovePlan?: (item: ChatItem) => Promise<void>
  onCorrectPlan?: (item: ChatItem, guidance: string) => Promise<void>
  onRejectPlan?: (item: ChatItem) => void
  onConfirmPrepared?: () => Promise<void>
  onDismissPrepared?: () => void
  onRetryPreparedDelivery?: (requestId?: string) => Promise<void>
  onOpenFile?: (path: string) => void
  onRevertChange?: (item: ChatItem) => Promise<void>
  onReprocessPolicyBlock?: () => Promise<void>
	 canReprocessPolicyBlock?: boolean
	 onRepairWithGPT?: (detail: string) => Promise<void>
	 canRepairWithGPT?: boolean
	 onRetryDependencyNetwork?: () => Promise<void>
	 canRetryDependencyNetwork?: boolean
	 onRetryTransportFailure?: (requestId: string) => Promise<void>
	 onResendPendingRequest?: (requestId: string) => Promise<void>
	 onCancelPendingRequest?: (requestId: string) => Promise<void>
  onExportChat?: () => Promise<void>
  onNewChat: (initialMessage?: string) => Promise<void>
  onSelectChat: (chatId: string) => Promise<void>
  onSaveChat?: (chatId: string) => Promise<void>
  onArchiveChat: (chatId: string) => Promise<void>
  onRestoreChat: (chatId: string) => Promise<void>
  onDeleteArchivedChat: (chatId: string) => Promise<void>
  onRenameChat?: (chatId: string, title: string) => Promise<void>
  onGenerateChatTitle?: (chatId: string) => Promise<void>
}
