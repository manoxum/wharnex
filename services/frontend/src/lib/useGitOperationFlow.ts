import { useState, type Dispatch, type SetStateAction } from 'react'
import type { GitOperationPreview, GitOverview, Session } from '../types'
import { api, APIError } from './api'
import { announceGitChanged } from './gitLiveSync'
import type { GitRepositoryOverviewEntry } from './gitProjectOverview'
import type { GitOperation, GitOperationTarget } from '../components/GitOperationModal'

type Params = {
  sessionId: string
  onSession?: (session: Session) => void
  loadOverview: () => Promise<GitOverview>
  report: (error: unknown) => void
  repositoryTargets: GitOperationTarget[]
  availableEntries: GitRepositoryOverviewEntry[]
  setWorking: Dispatch<SetStateAction<boolean>>
  setNotice: Dispatch<SetStateAction<string>>
  setNoticeError: Dispatch<SetStateAction<boolean>>
}

export function useGitOperationFlow(params: Params) {
  const { sessionId, onSession, loadOverview, report, repositoryTargets, availableEntries, setWorking, setNotice, setNoticeError } = params
  const [operation, setOperation] = useState<GitOperation | null>(null)

  async function runGitOperation(title: string, detail: string, action: () => Promise<string>, syncSession = false) {
    let phase: 'running' | 'refreshing' = 'running'
    let actionMessage = ''
    setWorking(true); setNotice(''); setNoticeError(false); setOperation({ title, detail, phase })
    try {
      actionMessage = await action()
      phase = 'refreshing'; setOperation({ title, detail, phase })
      await loadOverview(); announceGitChanged(sessionId)
      if (syncSession && onSession) onSession(await api.getSession(sessionId))
      setNotice(actionMessage); setOperation({ title, detail, phase: 'success', message: actionMessage })
      return true
    } catch (error) {
      const cause = error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
      const message = phase === 'refreshing' && actionMessage ? `${actionMessage} Não foi possível atualizar o painel: ${cause}` : cause
      report(error); setOperation({ title, detail, phase: 'error', message, failedPhase: phase })
      return false
    } finally { setWorking(false) }
  }

  async function reviewGitOperation(title: string, detail: string, preview: () => Promise<GitOperationPreview[]>, action: () => Promise<string>, syncSession = false) {
    setWorking(true); setNotice(''); setNoticeError(false); setOperation({ title, detail, phase: 'preparing' })
    try {
      const previews = await preview()
      setOperation({ title, detail, phase: 'reviewing', previews, onConfirmReview: () => { void runGitOperation(title, detail, action, syncSession) } })
    } catch (error) {
      report(error)
      const message = error instanceof Error ? error.message : String(error)
      setOperation({ title, detail, phase: 'error', message, failedPhase: 'preparing' }); setWorking(false)
    }
  }

  function selectRepositories(title: string, detail: string, action: (targets: string[]) => Promise<string>, syncSession = false, allowedTargets = repositoryTargets, preview?: (targets: string[]) => Promise<GitOperationPreview[]>) {
    const eligible = allowedTargets.filter((target) => target.available !== false)
    const execute = (targets: string[]) => preview
      ? void reviewGitOperation(title, detail, () => preview(targets), () => action(targets), syncSession)
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
