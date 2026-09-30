import type { CommandResult } from '../execution/contracts'

export type ChatArtifactKind = 'context' | 'prompt' | 'result' | 'error'
export type ChatArtifactSelection = Record<ChatArtifactKind, boolean>
export type ChatRequestMode = 'direct' | 'plan_first'
export type QueuedChatRequest = {
  id: string
  message: string
  attachments: File[]
  projectFiles: string[]
  artifacts: ChatArtifactSelection
  requestMode: ChatRequestMode
  createdAt: string
}
export type ChatItemSource = 'user' | 'chatgpt' | 'wharness'
export type ChatItemPresentation = 'message' | 'notice' | 'thought' | 'plan' | 'change'
export type ChatPlanApproval = { status: 'pending' | 'approved' | 'rejected' | 'superseded'; originalMessage?: string; requestId: string }
export type ChatChangeFile = { path: string; additions: number; deletions: number; diff: string }
// `summary` is the planner's own short description of what the bundle did. The
// protocol requires it on every plan-bearing response, and the self-evolution
// activation dialog shows it as the explanation of what a restart activates.
export type ChatChangeSummary = { planId: string; requestId?: string; summary?: string; files: ChatChangeFile[]; hostCommands?: CommandResult[]; appliedAt: string; reverted?: boolean; canRevert: boolean }
