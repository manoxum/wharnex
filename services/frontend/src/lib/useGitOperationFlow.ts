import { useState, type Dispatch, type SetStateAction } from 'react'
import type { GitOperationPreview, GitOverview, Session } from '../types'
import { api, APIError } from './api'
import { announceGitChanged } from './gitLiveSync'
import type { GitRepositoryOverviewEntry } from './gitProjectOverview'
import type { GitOperation, GitOperationTarget } from '../components/GitOperationModal'

export type GitOperationRunResult = { ok: boolean; error?: string }

export type GitQuickCommitAction = {
  fileCount: number
  repositoryCount: number
  unavailableReason?: string
  run: (message: string) => Promise<string>
}

type Params = {
  sessionId: string
  onSession?: (session: Session) => void
  onSync?: () => void
  loadOverview: () => Promise<GitOverview>
  report: (error: unknown) => void
  repositoryTargets: GitOperationTarget[]
  availableEntries: GitRepositoryOverviewEntry[]
  setWorking: Dispatch<SetStateAction<boolean>>
  setNotice: Dispatch<SetStateAction<string>>
  setNoticeError: Dispatch<SetStateAction<boolean>>
}

export function useGitOperationFlow(params: Params) {
  const { sessionId, onSession, onSync, loadOverview, report, repositoryTargets, availableEntries, setWorking, setNotice, setNoticeError } = params
  const [operation, setOperation] = useState<GitOperation | null>(null)

  async function syncAfterMutation(syncSession: boolean) {
    await loadOverview(); announceGitChanged(sessionId)
    if (syncSession && onSession) onSession(await api.getSession(sessionId))
    if (syncSession) onSync?.()
  }

  async function runGitOperation(title: string, detail: string, action: () => Promise<string>, syncSession = false) {
    let phase: 'running' | 'refreshing' = 'running'
    let actionMessage = ''
    setWorking(true); setNotice(''); setNoticeError(false); setOperation({ title, detail, phase })
    try {
      actionMessage = await action()
      phase = 'refreshing'; setOperation({ title, detail, phase })
      await syncAfterMutation(syncSession)
      setNotice(actionMessage); setOperation({ title, detail, phase: 'success', message: actionMessage })
      return { ok: true } satisfies GitOperationRunResult
    } catch (error) {
      const cause = error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
      const message = phase === 'refreshing' && actionMessage ? `${actionMessage} Não foi possível atualizar o painel: ${cause}` : cause
      report(error); setOperation({ title, detail, phase: 'error', message, failedPhase: phase })
      return { ok: false, error: message } satisfies GitOperationRunResult
    } finally { setWorking(false) }
  }

  async function reviewGitOperation(
    title: string,
    detail: string,
    preview: () => Promise<GitOperationPreview[]>,
    action: () => Promise<string>,
    syncSession = false,
    quickCommit?: GitQuickCommitAction,
  ) {
    const showReview = (previews: GitOperationPreview[], reviewMessage = '', commitAction: GitQuickCommitAction | null | undefined = quickCommit) => {
      setWorking(false)
      setOperation({
        title,
        detail,
        phase: 'reviewing',
        previews,
        reviewMessage: reviewMessage || undefined,
        quickCommit: commitAction ? {
          fileCount: commitAction.fileCount,
          repositoryCount: commitAction.repositoryCount,
          unavailableReason: commitAction.unavailableReason,
          onCommit: (message) => { void commitAndRefreshReview(message, commitAction) },
        } : undefined,
        onConfirmReview: () => { void runGitOperation(title, detail, action, syncSession) },
      })
    }

    async function commitAndRefreshReview(message: string, commitAction: GitQuickCommitAction) {
      let commitMessage = ''
      setWorking(true); setNotice(''); setNoticeError(false); setOperation({ title, detail, phase: 'preparing' })
      try {
        commitMessage = await commitAction.run(message)
        await syncAfterMutation(syncSession)
        const previews = await preview()
        showReview(previews, `${commitMessage} O diff do push foi recalculado com o novo HEAD.`, null)
      } catch (error) {
        const cause = error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
        const failure = commitMessage
          ? `${commitMessage} O commit foi criado, mas não foi possível recalcular o diff do push: ${cause}`
          : cause
        report(error); setOperation({ title, detail, phase: 'error', message: failure, failedPhase: 'preparing' }); setWorking(false)
      }
    }

    setWorking(true); setNotice(''); setNoticeError(false); setOperation({ title, detail, phase: 'preparing' })
    try {
      const previews = await preview()
      // Preparing is automated work, but reviewing waits for an explicit user
      // decision. Release the drawer-wide busy state before that interactive
      // phase so the Git surface does not look permanently blocked.
      showReview(previews)
    } catch (error) {
      report(error)
      const message = error instanceof Error ? error.message : String(error)
      setOperation({ title, detail, phase: 'error', message, failedPhase: 'preparing' }); setWorking(false)
    }
  }

  function selectRepositories(
    title: string,
    detail: string,
    action: (targets: string[]) => Promise<string>,
    syncSession = false,
    allowedTargets = repositoryTargets,
    preview?: (targets: string[]) => Promise<GitOperationPreview[]>,
    quickCommit?: (targets: string[]) => GitQuickCommitAction | undefined,
  ) {
    const eligible = allowedTargets.filter((target) => target.available !== false)
    const execute = (targets: string[]) => preview
      ? void reviewGitOperation(title, detail, () => preview(targets), () => action(targets), syncSession, quickCommit?.(targets))
      : void runGitOperation(title, detail, () => action(targets), syncSession)
    if (eligible.length <= 1) { execute(eligible.map((target) => target.path)); return }
    setOperation({ title, detail, phase: 'selecting', targets: allowedTargets, onConfirmTargets: execute })
  }

  async function previewsForRepositories(targets: string[], build: (entry: GitRepositoryOverviewEntry) => Promise<GitOperationPreview>) {
    const previews: GitOperationPreview[] = []
    for (const target of targets) {
      const entry = availableEntries.find((item) => item.repository.path === target)
      if (entry) previews.push(await build(entry))
    }
    return previews
  }

  function closeOperation() {
    if (operation?.phase === 'reviewing' || operation?.phase === 'preparing') setWorking(false)
    setOperation(null)
  }

  return { operation, runGitOperation, reviewGitOperation, selectRepositories, previewsForRepositories, closeOperation }
}
