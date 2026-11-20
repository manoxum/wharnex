import type { ComponentProps } from 'react'
import { repositoryOutgoing } from '../../../../lib/git/workflow/gitProjectOverview'
import { ChangesTabs } from '../GitTabs'
import { Icon } from '../../../presentation/chrome/Icon'
import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
import { GitProjectWorktree } from './GitProjectWorktree'
import { GitPendingRepositories } from './GitPendingRepositories'
import { visibleChangesRepositories } from './gitChangesModel'
import { useGitChangesActions } from './useGitChangesActions'

type Props = Parameters<typeof useGitChangesActions>[0] & {
  disabled: boolean
  active: ComponentProps<typeof ChangesTabs>['active']
  onChange: ComponentProps<typeof ChangesTabs>['onChange']
  onMessageChange: (message: string) => void
  onToggle: (key: string) => void
  onOpenDiff: (repository: string, path: string) => void
  conflictMessage: ComponentProps<typeof GitPendingRepositories>['conflictMessage']
}

export function GitChangesPanel(props: Props) {
  const { entries, disabled, active, onChange, selected, message, onMessageChange, onToggle, onOpenDiff, sessionId, flow, repositoryTargets, runForRepositories, conflictMessage } = props
  const actions = useGitChangesActions(props)
  const visible = visibleChangesRepositories(entries)
  const workingCount = entries.reduce((sum, entry) => sum + (entry.overview?.working.files.length || 0), 0)
  const pendingCount = entries.reduce((sum, entry) => sum + repositoryOutgoing(entry), 0)
  const changedSubmodules = visible.filter((entry) => !entry.repository.root && Boolean(entry.overview?.working.files.length)).length
  const pendingEntries = visible.filter((entry) => entry.repository.available && entry.overview && (entry.repository.root || repositoryOutgoing(entry) > 0))
  return <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
    {(changedSubmodules > 0 || actions.outgoingCount > 0 || actions.sendReason) && <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2" aria-label="Ações de todos os repositórios">
      <span className="text-xs text-whx-faint">{changedSubmodules > 0 && <>{formatMessage('Submódulos com alterações locais: {count}', { count: changedSubmodules })}{actions.outgoingCount > 0 ? ' · ' : ''}</>}{actions.outgoingCount > 0 && formatMessage('Commits por enviar: {count}', { count: pendingCount })}</span>
      {actions.outgoingCount > 0 && <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-whx-border bg-whx-surface px-3 py-1.5 text-sm! font-semibold! text-whx-text hover:bg-whx-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--theme-accent)] disabled:opacity-45" disabled={disabled || Boolean(actions.sendReason)} title={actions.sendReason || uiText('Enviar todos os commits pendentes para os respetivos remotos')} onClick={() => void actions.pushAll()}><Icon name="arrow-up" size={13}/>{uiText('Enviar commits')}</button>}
    </div>}
    {actions.sendReason && <p className="m-0 shrink-0 text-xs text-whx-warning" role="status">{actions.sendReason}</p>}
    {entries.some((entry) => entry.error || !entry.repository.available) && <p className="m-0 shrink-0 text-xs text-whx-warning" role="status">Alguns repositórios estão indisponíveis. Consulte Branches para verificar o inventário completo.</p>}
    <ChangesTabs active={active} workingCount={workingCount} pendingCount={pendingCount} onChange={onChange}/>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {active === 'working' && <GitProjectWorktree entries={visible} disabled={disabled} selected={selected} message={message} onMessageChange={onMessageChange} onToggle={onToggle} onCommit={() => void actions.commitSelected()} onOpenDiff={onOpenDiff} collective={{
      repositoryCount: actions.repositoryCount, commitReason: actions.commitReason, pushReason: actions.pushReason,
      onCommitAll: () => void actions.commitAll(), onCommitPush: () => void actions.commitPush(),
    }}/>}
    {active === 'pending' && <GitPendingRepositories session={{ id: sessionId }} entries={pendingEntries} disabled={disabled} repositoryTargets={repositoryTargets || []} selectRepositories={flow.selectRepositories} reviewGitOperation={flow.reviewGitOperation} previewsForRepositories={flow.previewsForRepositories} runForRepositories={runForRepositories} conflictMessage={conflictMessage}/>}
    </div>
  </div>
}
