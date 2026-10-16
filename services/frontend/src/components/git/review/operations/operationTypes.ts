import type { GitOperationPreview } from '../../../../types'

export type GitOperationPhase = 'selecting' | 'preparing' | 'reviewing' | 'running' | 'refreshing' | 'success' | 'error'
export type GitOperationTarget = {
  path: string
  label: string
  branch: string
  detail?: string
  ahead?: number
  behind?: number
  available?: boolean
}
export type GitOperation = {
  title: string
  detail: string
  phase: GitOperationPhase
  message?: string
  failedPhase?: 'preparing' | 'running' | 'refreshing'
  targets?: GitOperationTarget[]
  defaultTargets?: string[]
  onConfirmTargets?: (paths: string[]) => void
  previews?: GitOperationPreview[]
  onConfirmReview?: () => void
  reviewMessage?: string
  quickCommit?: {
    fileCount: number
    repositoryCount: number
    unavailableReason?: string
    onCommit: (message: string) => void
  }
}
