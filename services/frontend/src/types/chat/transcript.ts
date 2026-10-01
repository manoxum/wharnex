import type { Session } from '../agent/session'
import type { Interview, TurnKind } from '../agent/turn'
import type { ChatArtifactKind, ChatChangeSummary, ChatItemPresentation, ChatItemSource, ChatPlanApproval } from './request'
import type { ExecutionResult } from '../execution/contracts'

export type ChatGPTActivity = { cacheKey?: string; requestId?: string; state: 'idle' | 'thinking'; text: string; capturedAt: string }
export type ChatIterationRef = {
  id: string
  requestId: string
  phase: 'outbound' | 'prepared' | 'submitted' | 'workflow' | 'repair' | 'conflict' | 'result' | 'failed'
  artifacts: ChatArtifactKind[]
  chatgptUrl?: string
}

export type ChatAttachmentInfo = {
  name: string
  size: number
  mime?: string
  storageRef?: string
  previewKind?: 'thumbnail' | 'icon' | 'none'
}

export type ChatItem = { id: string; role: 'user' | 'harness'; text: string; createdAt?: string; meta?: string; turnKind?: TurnKind; attachments?: ChatAttachmentInfo[]; iteration?: ChatIterationRef; source?: ChatItemSource; presentation?: ChatItemPresentation; approval?: ChatPlanApproval; change?: ChatChangeSummary; interview?: Interview }

export type BundleSubmission = { session: Session; auto_executed: boolean; auto_applied: boolean; auto_error?: string; execution?: ExecutionResult; policy_blocked?: boolean; policy_reasons?: string[]; repair_prepared?: boolean; remote_recovery_prepared?: boolean; conflict_prepared?: boolean; workflow_executed?: boolean; workflow_prepared?: boolean; context_incremented?: boolean; workflow_round?: number; restart_scheduled?: boolean; restart_required?: boolean }

export type ProjectStorageUsage = { project_path: string; session_count: number; context_bytes: number; sandbox_bytes: number; artifact_bytes: number; archive_bytes: number; total_bytes: number }
export type BackendStorageUsage = { total_bytes: number; state_bytes: number; context_bytes: number; sandbox_bytes: number; artifact_bytes: number; archive_bytes: number; orphan_bytes: number; projects: ProjectStorageUsage[] }
