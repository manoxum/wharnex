import { GitPanelHeader } from './presentation/GitPanelHeader'
import { GitTabContent } from './presentation/GitTabContent'
import { gitTabLabel } from './gitTabModel'
import { GitTabs, type GitTab, type GitChangesTab } from './GitTabs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitAuthorSettings, GitBranch, GitCommitMode, GitConflictStrategy, GitOperationPreview, GitOverview, GitPendingCommit, Session } from '../../../types'
import { api, APIError } from '../../../lib/transport/http/api'
import { announceGitChanged } from '../../../lib/git/workflow/gitLiveSync'
import { useGitLiveRefresh } from '../../../lib/git/workflow/useGitLiveRefresh'
import { confirmDialog } from '../../../lib/desktop/bridge/appDialog'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { GitDiffReview } from './GitDiffReview'
import { GitOperationModal, type GitOperationTarget } from './GitOperationModal'
import { GitContributorsSection } from '../history/GitContributorsSection'
import { GitProjectPublication } from '../publication'
import { HistorySection } from '../history'
import { GitChangesPanel, visibleChangesRepositories, gitPushMessage } from './changes'
import { GitReleasePanel, type GitReleasePublishResult } from '../release/GitReleasePanel'
import { releaseTagName } from '../release/GitReleaseTag'
import { ConflictResolverModal } from '../../editor/inspector/ConflictResolverModal'
import { currentBranch, loadGitProjectOverviews, repositoryLabel, repositoryRemote, type GitRepositoryOverviewEntry } from '../../../lib/git/workflow/gitProjectOverview'
import { worktreeKey } from '../../../lib/git/workflow/gitWorktreeKey'
import { useGitOperationFlow } from '../../../lib/git/workflow/useGitOperationFlow'
import { useGitConflictReview } from '../../../lib/git/workflow/useGitConflictReview'

import { WorktreeDiffModal, type WorktreeDiffState } from './changes/WorktreeDiffModal'

export function GitDrawer({ session, busy, onClose, onError, onSession, onResolveConflictWithGPT, onOpenGitConflictChat }: {
  session: Session
  busy: boolean
  onClose: () => void
  onError?: (message: string) => void
  onSession?: (session: Session) => void
  onResolveConflictWithGPT?: (session: Session) => Promise<void>
  onOpenGitConflictChat?: (session: Session) => Promise<void>
}) {
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [repositoryEntries, setRepositoryEntries] = useState<GitRepositoryOverviewEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)
  const [openDiff, setOpenDiff] = useState<GitPendingCommit | null>(null)
  const [worktreeDiff, setWorktreeDiff] = useState<WorktreeDiffState | null>(null)
  const [mergeRef, setMergeRef] = useState('')
  const [remoteMergeTarget, setRemoteMergeTarget] = useState('')
  const [remoteMergeSources, setRemoteMergeSources] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<GitTab>('changes')
  const [activeChangesTab, setActiveChangesTab] = useState<GitChangesTab>('working')
  const [selectedWorktree, setSelectedWorktree] = useState<Set<string>>(new Set())
  const [worktreeCommitMessage, setWorktreeCommitMessage] = useState('')

  const report = useCallback((error: unknown) => {
    const message = error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
    setNotice(message)
    setNoticeError(true)
    onError?.(message)
  }, [onError])

  const loadOverview = useCallback(async () => {
    const next = await loadGitProjectOverviews(session.id)
    setOverview(next.root)
    setRepositoryEntries(next.entries)
    return next.root
  }, [session.id])

  const refresh = useCallback(async () => {
    try {
      await loadOverview()
    } catch (error) {
      report(error)
    } finally {
      setLoading(false)
    }
  }, [loadOverview, report])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void refresh() }, [session.last_host_applied_at, session.state, refresh])
  useGitLiveRefresh(session.id, refresh)
  useEffect(() => {
    const committable = new Set(repositoryEntries.flatMap((entry) => (entry.overview?.working.files || [])
      .filter((file) => file.kind === 'change' || file.kind === 'gitlink')
      .map((file) => worktreeKey(entry.repository.path, file.path))))
    setSelectedWorktree((currentSelection) => new Set(Array.from(currentSelection).filter((key) => committable.has(key))))
  }, [repositoryEntries])

  const localBranches = useMemo(() => (overview?.branches || []).filter((branch) => !branch.remote), [overview])
  const remoteBranches = useMemo(() => (overview?.branches || []).filter((branch) => branch.remote), [overview])
  const current = useMemo(() => localBranches.find((branch) => branch.current), [localBranches])
  const pending = overview?.pending || []
  const availableEntries = useMemo(() => repositoryEntries.filter((entry) => entry.repository.available && entry.overview), [repositoryEntries])
  const repositoryTargets = useMemo<GitOperationTarget[]>(() => repositoryEntries.map((entry) => {
    const branch = currentBranch(entry.overview)
    return {
      path: entry.repository.path,
      label: repositoryLabel(entry),
      branch: entry.overview?.detached ? 'HEAD destacado' : branch?.name || entry.repository.current_branch || 'sem branch',
      detail: branch?.has_upstream && !branch.gone ? branch.upstream : 'branch apenas local',
      ahead: branch?.ahead || 0,
      behind: branch?.behind || 0,
      available: entry.repository.available && Boolean(entry.overview),
    }
  }), [repositoryEntries])

  const { operation, runGitOperation, reviewGitOperation, selectRepositories, previewsForRepositories, closeOperation } = useGitOperationFlow({
    sessionId: session.id, onSession, loadOverview, report, repositoryTargets, availableEntries, setWorking, setNotice, setNoticeError,
  })
  const { conflictReview, conflictMessage, closeConflictReview } = useGitConflictReview({
    session, strategy: overview?.conflict_strategy, onSession, onResolveConflictWithGPT, onOpenGitConflictChat, report,
  })
  async function runForRepositories(targets: string[], action: (entry: GitRepositoryOverviewEntry) => Promise<string>) {
    const successes: string[] = []
    const failures: string[] = []
    for (const target of targets) {
      const entry = availableEntries.find((item) => item.repository.path === target)
      if (!entry) continue
      const label = repositoryLabel(entry)
      try { successes.push(`${label}: ${await action(entry)}`) }
      catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    if (failures.length) throw new Error(`${successes.length ? `${successes.length} repositório(s) concluído(s). ` : ''}Falhou em ${failures.join(' | ')}`)
    if (successes.length === 1) return successes[0].replace(/^[^:]+: /, '')
    return `Operação concluída em ${successes.length} repositórios.`
  }

  async function run(action: () => Promise<void>, syncSession = false) {
    setWorking(true)
    setNotice('')
    setNoticeError(false)
    try {
      await action()
      await refresh()
      announceGitChanged(session.id)
      if (syncSession && onSession) onSession(await api.getSession(session.id))
    } catch (error) {
      report(error)
    } finally {
      setWorking(false)
    }
  }


  const disabled = busy || working || loading
  async function copyGitText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNoticeError(false)
      setNotice(success)
    } catch (error) {
      report(error)
    }
  }


  function toggle(id: string) {
    setSelected((currentSelection) => {
      const next = new Set(currentSelection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function commit(ids: string[]) {
    const title = ids.length ? 'A criar commits selecionados' : 'A criar commits'
    const detail = ids.length ? `${ids.length} registo(s) selecionado(s) serão adicionados ao histórico local.` : 'A fila pendente será registada no histórico local.'
    await reviewGitOperation(title, detail,
      async () => [await api.gitPreview(session.id, { operation: 'commit', pending_ids: ids })],
      async () => {
        const result = await api.commitGitPending(session.id, ids)
        setSelected(new Set())
        const made = result.outcomes.filter((outcome) => outcome.commit_sha).length
        const skipped = result.outcomes.filter((outcome) => outcome.skipped).length
        return `${made} commit(s) criado(s)${skipped ? `, ${skipped} registo(s) obsoleto(s) retirado(s)` : ''}.`
      },
    )
  }


  return <section className="git-drawer" aria-label="Git do projeto">
    <GitPanelHeader branch={overview?.available ? overview.detached ? 'HEAD destacado' : current?.name || overview.current_branch || 'sem branch' : undefined} disabled={disabled} onRefresh={() => void refresh()} onClose={onClose}/>

    {loading && <ContentSkeleton label="A carregar estado do repositório" rows={5}/>}
    {!loading && overview && !overview.available && <p className="git-empty warning-card">Não foi possível inspecionar o repositório: {overview.unavailable}</p>}

    {overview?.available && <>
      <GitProjectPublication sessionId={session.id} entries={repositoryEntries} summaryEntries={activeTab === 'changes' ? visibleChangesRepositories(repositoryEntries) : repositoryEntries} disabled={disabled} flow={{ reviewGitOperation }} loadOverview={loadOverview}/>
      <GitTabs active={activeTab} onChange={setActiveTab} overview={overview}/>
      {notice && <p className={`git-notice ${noticeError ? 'error-card' : ''}`} role={noticeError ? 'alert' : 'status'}>{notice}</p>}
      {overview.conflict && <div className="git-conflict-card warning-card">
        <strong>Conflito de Git em resolução</strong>
        <p>A integrar <code>{overview.conflict.ref}</code>. A resolução está no chat e o merge será concluído localmente quando chegar.</p>
      </div>}
      {overview.in_progress && <p className="git-notice warning-card">Há um <strong>{overview.in_progress}</strong> em curso no host. Termine-o ou aborte-o antes de aplicar ou fazer merge.</p>}

      <GitTabContent label={gitTabLabel(activeTab)} stretch={activeTab === 'changes'}>
        {activeTab === 'changes' && <GitChangesPanel
          sessionId={session.id} entries={repositoryEntries} disabled={disabled}
          active={activeChangesTab} onChange={setActiveChangesTab}
          selected={selectedWorktree} message={worktreeCommitMessage} onMessageChange={setWorktreeCommitMessage}
          onToggle={(key) => setSelectedWorktree((currentSelection) => {
            const next = new Set(currentSelection)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })}
          resetCommit={() => { setSelectedWorktree(new Set()); setWorktreeCommitMessage('') }}
          flow={{ reviewGitOperation, selectRepositories, previewsForRepositories }}
          loadOverview={loadOverview} runForRepositories={runForRepositories}
          repositoryTargets={repositoryTargets} conflictMessage={conflictMessage}
          onOpenDiff={(repositoryPath, path) => void (async () => {
            try {
              const targets = repositoryEntries.flatMap((entry) => (entry.overview?.working.files || []).map((file) => ({
                repository: entry.repository.path, repositoryLabel: repositoryLabel(entry), file,
              })))
              const initialTarget = targets.find((target) => target.repository === repositoryPath && target.file.path === path)
              if (!initialTarget) throw new Error(`Não foi possível localizar ${path} no worktree atual.`)
              const initialFile = await api.gitFileDiff(session.id, path, repositoryPath)
              setWorktreeDiff({ initialFile, initialTarget, targets })
            } catch (error) { report(error) }
          })()}
        />}
        {activeTab === 'history' && availableEntries.map((entry) => <HistorySection key={entry.repository.path || '__root__'} sessionId={session.id} repository={entry.repository.path} repositoryLabel={repositoryEntries.length > 1 ? repositoryLabel(entry) : undefined} branches={entry.overview!.branches}/>)}
        {activeTab === 'contributors' && availableEntries.map((entry) => <GitContributorsSection key={entry.repository.path || '__root__'} sessionId={session.id} repository={entry.repository.path} repositoryLabel={repositoryEntries.length > 1 ? repositoryLabel(entry) : undefined}/>)}
        {activeTab === 'branches' && <BranchSection
          sessionId={session.id} repository="" allowCurrentSwitch={availableEntries.length > 1}
          current={current?.name || overview.current_branch} detached={overview.detached}
          localBranches={localBranches} remoteBranches={remoteBranches} remotes={overview.remotes}
          projectVersion={overview.project_version || ''} tags={overview.tags || []}
          disabled={disabled} mergeRef={mergeRef} onMergeRefChange={setMergeRef}
          remoteMergeTarget={remoteMergeTarget} remoteMergeSources={remoteMergeSources}
          onRemoteMergeTargetChange={setRemoteMergeTarget} onRemoteMergeSourcesChange={setRemoteMergeSources}
          onRemoteMerge={() => selectRepositories(
            'A integrar branches remotas',
            `A integrar ${remoteMergeSources.join(', ')} em ${remoteMergeTarget} sem alterar a branch local.`,
            async (paths) => {
              const message = await runForRepositories(paths, async (entry) => {
                const result = await api.gitRemoteMerge(session.id, remoteMergeTarget, remoteMergeSources, entry.repository.path)
                if (result.outcome === 'conflict') return result.conflict_id ? conflictMessage(result.conflict_id, `Merge remoto encontrou conflito em ${result.conflict_ref}; nenhuma branch local ou remota foi alterada.`) : (result.detail || `Merge remoto encontrou conflito em ${result.conflict_ref}.`)
                return `Merge remoto em ${result.target_ref}: ${result.outcome}${result.push_outcome ? ` · push ${result.push_outcome}` : ''}.`
              })
              setRemoteMergeSources([])
              return message
            },
            true,
            repositoryTargets,
            async (paths) => {
              const previews: GitOperationPreview[] = []
              for (const path of paths) {
                const entry = availableEntries.find((item) => item.repository.path === path)
                if (!entry?.overview) continue
                const selectedRefs = new Set([remoteMergeTarget, ...remoteMergeSources])
                const remotes = entry.overview.branches.filter((branch) => selectedRefs.has(branch.name) && branch.remote).map((branch) => branch.remote!)
                for (const source of remoteMergeSources) previews.push(await api.gitPreview(session.id, { operation: 'merge', repository: entry.repository.path, base_ref: remoteMergeTarget, ref: source, refresh_remotes: remotes }))
              }
              return previews
            },
          )}
          onMerge={() => selectRepositories(
            'A integrar branch',
            `A fazer merge de ${mergeRef} na branch atual.`,
            async (paths) => {
              const message = await runForRepositories(paths, async (entry) => {
                const result = await api.gitMerge(session.id, mergeRef, entry.repository.path)
                return result.conflict_id ? conflictMessage(result.conflict_id, `Merge de ${result.ref} entrou em conflito.`) : (result.detail || `Merge de ${result.ref}: ${result.outcome}.`)
              })
              setMergeRef('')
              return message
            },
            true,
            repositoryTargets,
            (paths) => previewsForRepositories(paths, (entry) => api.gitPreview(session.id, { operation: 'merge', repository: entry.repository.path, ref: mergeRef })),
          )}
          onFetch={(remote) => selectRepositories(
            'A procurar alterações na origem',
            `Escolha os repositórios cujas referências remotas serão atualizadas.`,
            async (paths) => runForRepositories(paths, async (entry) => {
              const selectedRemote = repositoryRemote(entry, remote)
              if (!selectedRemote) throw new Error('Este repositório não tem remoto configurado.')
              await api.gitFetch(session.id, selectedRemote, entry.repository.path)
              return `Fetch de ${selectedRemote} concluído.`
            }),
          )}
          onPull={(remote) => selectRepositories(
            'A integrar alterações da origem',
            'Escolha os repositórios que devem receber alterações da respetiva branch remota.',
            async (paths) => runForRepositories(paths, async (entry) => {
              const selectedBranch = currentBranch(entry.overview)
              const selectedRemote = repositoryRemote(entry, remote)
              if (!selectedBranch || !selectedRemote) throw new Error('Este repositório não tem branch/remoto disponível para pull.')
              const result = await api.gitPull(session.id, selectedRemote, selectedBranch.name, entry.repository.path)
              return result.conflict_id ? conflictMessage(result.conflict_id, `Pull de ${result.ref} encontrou conflito.`) : (result.detail || `Pull de ${result.ref}: ${result.outcome}.`)
            }),
            true,
            repositoryTargets,
            (paths) => previewsForRepositories(paths, async (entry) => {
              const selectedBranch = currentBranch(entry.overview)
              const selectedRemote = repositoryRemote(entry, remote)
              if (!selectedBranch || !selectedRemote) throw new Error('Este repositório não tem branch/remoto disponível para pull.')
              return api.gitPreview(session.id, { operation: 'pull', repository: entry.repository.path, remote: selectedRemote, branch: selectedBranch.name })
            }),
          )}
          onSwitch={(branch) => selectRepositories(
            'A alternar branch',
            `Escolha os repositórios onde pretende alternar para ${branch}.`,
            async (paths) => runForRepositories(paths, async (entry) => { await api.gitSwitch(session.id, branch, entry.repository.path); return `Branch alterada para ${branch}.` }),
            true,
          )}
          onCreateBranch={(branch, startPoint) => selectRepositories(
            'A criar branch',
            `Escolha os repositórios onde ${branch} será criada.`,
            async (paths) => runForRepositories(paths, async (entry) => { await api.gitCreateBranch(session.id, branch, startPoint, entry.repository.path); return `Branch ${branch} criada a partir de ${startPoint || 'HEAD'}.` }),
          )}
          onDeleteBranch={(branch) => void (async () => {
            const confirmed = await confirmDialog({ title: `Remover branch ${branch}?`, message: 'Branches locais usam remoção segura sem força; branches remotas são removidas do remoto selecionado sem force push.', tone: 'danger', confirmLabel: 'Remover branch' })
            if (!confirmed) return
            selectRepositories('A remover branch', `Escolha os repositórios onde ${branch} será removida.`, async (paths) => runForRepositories(paths, async (entry) => { await api.gitDeleteBranch(session.id, branch, entry.repository.path); return `Branch ${branch} removida.` }))
          })()}
          onCopyBranch={(branch) => void copyGitText(branch, `Nome da branch ${branch} copiado.`)}
          onCopyTag={(tag) => void copyGitText(tag, `Tag ${tag} copiada.`)}
          onGenerateReleaseNotes={async (branch) => (await api.gitGenerateReleaseNotes(session.id, branch, '')).body}
          onCreateRelease={(input) => runGitOperation(
            'A publicar release',
            `A criar ${releaseTagName(overview.project_version || '', input.tag_suffix)} a partir de ${input.branch} e a publicar a release no remoto dessa branch.`,
            async () => {
              const result = await api.gitCreateRelease(session.id, input, '')
              return `Release ${result.tag} publicada${result.release_url ? ` · ${result.release_url}` : ''}.`
            },
          )}
          onPush={(remote) => selectRepositories(
            'A publicar alterações',
            'Escolha os repositórios cujas branches locais serão publicadas.',
            async (paths) => runForRepositories(paths, async (entry) => {
              const selectedBranch = currentBranch(entry.overview)
              const selectedRemote = repositoryRemote(entry, remote)
              if (!selectedBranch || !selectedRemote) throw new Error('Este repositório não tem branch/remoto disponível para push.')
              const result = await api.gitPush(session.id, selectedRemote, selectedBranch.name, !selectedBranch.has_upstream, entry.repository.path)
              if (result.conflict_id) return conflictMessage(result.conflict_id, gitPushMessage(result.outcome, result.integrated, result.conflict_id))
              return result.detail || gitPushMessage(result.outcome, result.integrated, result.conflict_id)
            }),
            true,
            repositoryTargets,
            (paths) => previewsForRepositories(paths, async (entry) => {
              const selectedBranch = currentBranch(entry.overview)
              const selectedRemote = repositoryRemote(entry, remote)
              if (!selectedBranch || !selectedRemote) throw new Error('Este repositório não tem branch/remoto disponível para push.')
              return api.gitPreview(session.id, { operation: 'push', repository: entry.repository.path, remote: selectedRemote, branch: selectedBranch.name })
            }),
          )}
        />}
        {activeTab === 'settings' && <>
          <RepositorySettings overview={overview} disabled={disabled}
            onCopyRemote={(name, url) => void copyGitText(url, `URL de ${name} copiada.`)}
            onChange={(mode) => run(async () => { await api.setGitCommitMode(session.id, mode) })}
            onConflictStrategy={(strategy) => run(async () => { await api.setGitConflictStrategy(session.id, strategy) })}
            onAuthorSettings={(settings) => run(async () => { await api.setGitAuthorSettings(session.id, settings) })}
          />
          <PendingSection
            pending={pending} selected={selected} disabled={disabled} hasIdentity={overview.has_identity}
            commitMode={overview.commit_mode} onToggle={toggle} onCommitAll={() => void commit([])}
            onCommitSelected={() => void commit(Array.from(selected))}
            onDiscard={(id) => void run(async () => { await api.discardGitPending(session.id, [id]) })}
            onOpenDiff={(record) => void (async () => {
              try { setOpenDiff(await api.gitPendingCommit(session.id, record.id)) } catch (error) { report(error) }
            })()}
          />
        </>}
      </GitTabContent>
    </>}

    {openDiff && <DiffModal sessionId={session.id} record={openDiff} onClose={() => setOpenDiff(null)} />}
    {worktreeDiff && <WorktreeDiffModal sessionId={session.id} state={worktreeDiff} onClose={() => setWorktreeDiff(null)}/>}
    {operation && <GitOperationModal operation={operation} sessionId={session.id} onClose={closeOperation}/>}
    {conflictReview && <ConflictResolverModal session={conflictReview.session} initialWorkbench={conflictReview.workbench} strategy={conflictReview.strategy} busy={busy || working} onClose={() => void closeConflictReview()} onSession={(updated) => onSession?.(updated)} onDelegateToGPT={async (updated) => { await onResolveConflictWithGPT?.(updated) }}/>}
  </section>
}



function RepositorySettings({ overview, disabled, onChange, onConflictStrategy, onAuthorSettings, onCopyRemote }: {
  overview: GitOverview; disabled: boolean; onChange: (mode: GitCommitMode) => void
  onConflictStrategy: (strategy: GitConflictStrategy) => void
  onAuthorSettings: (settings: GitAuthorSettings) => void
  onCopyRemote: (name: string, url: string) => void
}) {
  const authorSettings = overview.author_settings || { commit_author_strategy: 'wharnex_git_user' as const }
  const [authorStrategy, setAuthorStrategy] = useState(authorSettings.commit_author_strategy)
  const [customName, setCustomName] = useState(authorSettings.custom_author_name || '')
  const [customEmail, setCustomEmail] = useState(authorSettings.custom_author_email || '')
  useEffect(() => {
    setAuthorStrategy(authorSettings.commit_author_strategy)
    setCustomName(authorSettings.custom_author_name || '')
    setCustomEmail(authorSettings.custom_author_email || '')
  }, [authorSettings.commit_author_strategy, authorSettings.custom_author_name, authorSettings.custom_author_email])
  const needsCustom = authorStrategy === 'custom' || authorStrategy === 'wharnex_custom'
  return <div className="git-settings-stack">
    <CommitModeSection overview={overview} disabled={disabled} onChange={onChange}/>
    <section className="git-section">
      <div className="git-section-heading"><div><span>Conflitos</span><strong>Estratégia de resolução</strong></div></div>
      <label className="git-settings-field"><span>Quando o Git não consegue fazer merge sozinho</span><select aria-label="Estratégia de resolução de conflitos" value={overview.conflict_strategy || 'user_decide'} disabled={disabled} onChange={(event) => onConflictStrategy(event.target.value as GitConflictStrategy)}><option value="gpt_only">GPT only</option><option value="user_only">User only</option><option value="user_decide">User decide</option></select></label>
      <p className="git-hint">GPT only delega automaticamente; User only bloqueia delegação ao GPT; User decide mantém a escolha caso a caso.</p>
    </section>
    <section className="git-section">
      <div className="git-section-heading"><div><span>Global</span><strong>Autoria dos commits automáticos</strong></div></div>
      <label className="git-settings-field"><span>Identidade</span><select aria-label="Estratégia de autoria de commit" value={authorStrategy} disabled={disabled} onChange={(event) => setAuthorStrategy(event.target.value as GitAuthorSettings['commit_author_strategy'])}><option value="wharnex_git_user">WHX + utilizador Git (padrão)</option><option value="wharnex">Wharnex</option><option value="git_user">Utilizador Git autenticado</option><option value="custom">Utilizador específico</option><option value="wharnex_custom">WHX + utilizador específico</option></select></label>
      {needsCustom && <div className="git-author-custom-grid"><label><span>Nome</span><input value={customName} disabled={disabled} onChange={(event) => setCustomName(event.target.value)} placeholder="Nome do autor"/></label><label><span>Email</span><input type="email" value={customEmail} disabled={disabled} onChange={(event) => setCustomEmail(event.target.value)} placeholder="autor@example.com"/></label></div>}
      <div className="git-row"><button type="button" className="git-action primary" disabled={disabled || (needsCustom && (!customName.trim() || !customEmail.trim()))} onClick={() => onAuthorSettings({ commit_author_strategy: authorStrategy, custom_author_name: customName.trim() || undefined, custom_author_email: customEmail.trim() || undefined })}><Icon name="check" size={13}/> Guardar autoria</button></div>
      <p className="git-hint">A configuração é global. A combinação padrão produz autores como <code>WHX - Nome &lt;email&gt;</code> quando o Git tem user.name/user.email.</p>
    </section>
    <section className="git-section git-remotes-section">
      <div className="git-section-heading"><div><span>Remotos</span><strong>Destinos configurados</strong></div><span className="git-section-count">{overview.remotes.length}</span></div>
      {overview.remotes.length === 0 ? <p className="git-empty inline">Nenhum remoto configurado.</p> : <ul className="git-remote-list">
        {overview.remotes.map((remote) => <li key={remote.name}><Icon name="network" size={13}/><strong>{remote.name}</strong><span title={remote.url}>{remote.url}</span><button type="button" className="git-inline-copy" aria-label={`Copiar URL de ${remote.name}`} title="Copiar URL do remoto" onClick={() => onCopyRemote(remote.name, remote.url)}><Icon name="copy" size={11}/></button></li>)}
      </ul>}
    </section>
  </div>
}

function CommitModeSection({ overview, disabled, onChange }: { overview: GitOverview; disabled: boolean; onChange: (mode: GitCommitMode) => void }) {
  return <section className="git-section">
    <div className="git-section-heading"><div><span>Comportamento</span><strong>Modo de commit</strong></div></div>
    <div className="git-mode-switch" role="group" aria-label="Modo de commit">
      <button type="button" className={overview.commit_mode === 'auto' ? 'active' : ''} disabled={disabled || overview.commit_mode_fixed} onClick={() => onChange('auto')}><Icon name="check" size={13}/> Auto-commit</button>
      <button type="button" className={overview.commit_mode === 'manual' ? 'active' : ''} disabled={disabled || overview.commit_mode_fixed} onClick={() => onChange('manual')}><Icon name="clipboard" size={13}/> Sem auto-commit</button>
    </div>
    <p className="git-hint">{overview.commit_mode === 'auto' ? 'Cada alteração aplicada e verificada fica commitada de imediato no histórico local.' : 'As alterações aplicadas ficam no worktree por commitar, com mensagem e diff preservados para revisão.'}</p>
    {overview.commit_mode_fixed && <p className="git-hint">A auto-evolução do Wharnex commita sempre porque rollback e ativação dependem de commits reais.</p>}
    {!overview.has_identity && <p className="git-hint warning-card">O repositório não tem <code>user.name</code>/<code>user.email</code> configurados; os commits manuais vão falhar até os definir.</p>}
  </section>
}

function BranchSection({ sessionId, repository, allowCurrentSwitch, current, detached, localBranches, remoteBranches, remotes, projectVersion, tags, disabled, mergeRef, onMergeRefChange, onMerge, remoteMergeTarget, remoteMergeSources, onRemoteMergeTargetChange, onRemoteMergeSourcesChange, onRemoteMerge, onFetch, onPull, onSwitch, onCreateBranch, onDeleteBranch, onCopyBranch, onCopyTag, onGenerateReleaseNotes, onCreateRelease, onPush }: {
  sessionId: string; repository: string; allowCurrentSwitch: boolean; current?: string; detached: boolean; localBranches: GitOverview['branches']; remoteBranches: GitOverview['branches']; remotes: GitOverview['remotes']
  projectVersion: string; tags: GitOverview['tags']
  disabled: boolean; mergeRef: string; onMergeRefChange: (value: string) => void; onMerge: () => void
  remoteMergeTarget: string; remoteMergeSources: string[]; onRemoteMergeTargetChange: (value: string) => void; onRemoteMergeSourcesChange: (values: string[]) => void; onRemoteMerge: () => void
  onFetch: (remote: string) => void; onPull: (remote: string, branch: string) => void; onSwitch: (branch: string) => void
  onCreateBranch: (branch: string, startPoint: string) => void; onDeleteBranch: (branch: string) => void; onCopyBranch: (branch: string) => void; onCopyTag: (tag: string) => void
  onGenerateReleaseNotes: (branch: string) => Promise<string>; onCreateRelease: (input: { branch: string; tag_suffix: string; title: string; body: string }) => Promise<GitReleasePublishResult>
  onPush: (remote: string, branch: string, setUpstream: boolean) => void
}) {
  const active = localBranches.find((branch) => branch.current)
  const upstreamRemote = active?.upstream?.split('/')[0]
  const defaultRemote = upstreamRemote || remotes[0]?.name || 'origin'
  const canSync = Boolean(current) && !detached && remotes.length > 0
  const [localMergeOptions, setLocalMergeOptions] = useState<GitBranch[]>([])
  const [remoteMergeOptions, setRemoteMergeOptions] = useState<GitBranch[]>([])
  const [newBranch, setNewBranch] = useState('')
  const [newBranchBase, setNewBranchBase] = useState(current || 'HEAD')
  useEffect(() => { if (current) setNewBranchBase((value) => value === 'HEAD' || !value ? current : value) }, [current])
  useEffect(() => {
    let alive = true
    if (!current || detached) { setLocalMergeOptions([]); return () => { alive = false } }
    api.gitMergeCandidates(sessionId, current, repository).then((items) => { if (alive) setLocalMergeOptions(items) }).catch(() => { if (alive) setLocalMergeOptions([]) })
    return () => { alive = false }
  }, [sessionId, repository, current, detached, localBranches, remoteBranches])
  useEffect(() => {
    let alive = true
    if (!remoteMergeTarget) { setRemoteMergeOptions([]); return () => { alive = false } }
    api.gitMergeCandidates(sessionId, remoteMergeTarget, repository).then((items) => {
      if (!alive) return
      setRemoteMergeOptions(items)
      const eligible = new Set(items.map((item) => item.name))
      onRemoteMergeSourcesChange(remoteMergeSources.filter((ref) => eligible.has(ref)))
    }).catch(() => { if (alive) setRemoteMergeOptions([]) })
    return () => { alive = false }
  }, [sessionId, repository, remoteMergeTarget, localBranches, remoteBranches])
  const toggleRemoteMergeSource = (ref: string) => onRemoteMergeSourcesChange(remoteMergeSources.includes(ref) ? remoteMergeSources.filter((value) => value !== ref) : [...remoteMergeSources, ref])
  return <section className="git-section git-branches-section">
    <div className="git-branch-overview">
      <div className="git-branch-hero">
        <span className="git-branch-icon"><Icon name="git" size={16}/></span>
        <div className="git-branch-hero-copy">
          <span>Branch atual</span>
          <div className="git-branch-hero-name"><strong>{detached ? 'HEAD destacado' : current || '—'}</strong>{current && !detached && <button type="button" className="git-inline-copy" aria-label={`Copiar nome da branch ${current}`} title="Copiar nome da branch" onClick={() => onCopyBranch(current)}><Icon name="copy" size={11}/></button>}</div>
          {active && <div className="git-branch-hero-meta">
            {active.has_upstream ? <>
              {active.ahead > 0 && <span className="outgoing"><Icon name="arrow-up" size={10}/>{active.ahead} por enviar</span>}
              {active.behind > 0 && <span className="incoming"><Icon name="arrow-down" size={10}/>{active.behind} por receber</span>}
              {active.ahead === 0 && active.behind === 0 && <span className="clean"><Icon name="check" size={10}/>Em dia</span>}
              <span className="upstream"><Icon name="link" size={10}/>{active.upstream}</span>
            </> : <span className="warning"><Icon name="alert" size={10}/>Sem upstream</span>}
          </div>}
        </div>
        {canSync && active && <div className="git-branch-hero-actions" role="group" aria-label="Sincronização da branch atual">
          <button type="button" className="git-branch-icon-action" disabled={disabled} onClick={() => onFetch(defaultRemote)} aria-label={`Fetch de ${defaultRemote}`} title="Fetch"><Icon name="refresh" size={13}/></button>
          <button type="button" className="git-branch-icon-action" disabled={disabled} onClick={() => onPull(defaultRemote, active.name)} aria-label={`Pull de ${active.name}`} title="Pull"><Icon name="arrow-down" size={13}/></button>
          <button type="button" className="git-branch-icon-action primary" disabled={disabled} onClick={() => onPush(defaultRemote, active.name, !active.has_upstream)} aria-label={`Push de ${active.name}`} title="Push"><Icon name="arrow-up" size={13}/></button>
        </div>}
      </div>
      <div className="git-branch-refresh-note"><Icon name="refresh" size={11}/><span>Branch sincronizada em tempo real · referências remotas atualizadas a cada 60 s</span></div>
    </div>

    <div className="git-branch-management">
      <div className="git-branch-operations-heading">
        <div><span>Gestão</span><strong>Criar branch local</strong></div>
        <small>A nova branch é criada sem trocar o checkout atual.</small>
      </div>
      <div className="git-branch-create-row">
        <label><span>Nome</span><input aria-label="Nome da nova branch" value={newBranch} disabled={disabled} onChange={(event) => setNewBranch(event.target.value)} placeholder="feature/minha-branch"/></label>
        <label><span>A partir de</span><select aria-label="Branch base da nova branch" value={newBranchBase} disabled={disabled} onChange={(event) => setNewBranchBase(event.target.value)}><option value="HEAD">HEAD atual</option>{localBranches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select></label>
        <button type="button" className="git-action primary git-branch-create-action" disabled={disabled || !newBranch.trim()} onClick={() => { const branch = newBranch.trim(); onCreateBranch(branch, newBranchBase); setNewBranch('') }}>Criar branch</button>
      </div>
      <p className="git-hint">Branches locais usam <code>git branch -d</code>; referências remotas são removidas no respetivo remoto. Nenhuma remoção usa força.</p>
    </div>

    <div className="git-branch-operations">
      <div className="git-branch-operations-heading">
        <div><span>Integração</span><strong>Operações de merge</strong></div>
        <small>Escolha o fluxo sem perder o contexto da branch atual.</small>
      </div>
      <div className="git-merge-card">
        <div className="git-merge-card-heading">
          <span className="git-merge-card-icon"><Icon name="bridge" size={14}/></span>
          <div><span>Merge local</span><strong>Integrar no branch atual</strong></div>
        </div>
        <p className="git-hint">Combina outra branch diretamente na branch que está ativa.</p>
        <div className="git-row git-merge-inline-controls">
          <label className="sr-only" htmlFor="git-merge-ref">Branch a fazer merge</label>
          <select id="git-merge-ref" value={mergeRef} disabled={disabled} onChange={(event) => onMergeRefChange(event.target.value)}>
            <option value="">Escolher branch a integrar…</option>
            {localMergeOptions.map((branch) => <option key={branch.name} value={branch.name}>{branch.name} · {branch.unmerged_commits || 0} commit(s)</option>)}
          </select>
          <button type="button" className="git-action" disabled={disabled || !mergeRef} onClick={onMerge}><Icon name="bridge" size={13}/> Merge</button>
        </div>
      </div>
      <div className="git-merge-card git-remote-merge-card">
        <div className="git-merge-card-heading">
          <span className="git-merge-card-icon"><Icon name="network" size={14}/></span>
          <div><span>Merge remoto isolado</span><strong>Integrar entre branches remotas</strong></div>
        </div>
        <div className="git-remote-merge-controls">
          <label className="git-remote-target-field"><span>Destino remoto</span><select aria-label="Branch remota de destino" value={remoteMergeTarget} disabled={disabled} onChange={(event) => { onRemoteMergeTargetChange(event.target.value); onRemoteMergeSourcesChange(remoteMergeSources.filter((ref) => ref !== event.target.value)) }}><option value="">Escolher destino…</option>{remoteBranches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select></label>
          <fieldset className="git-remote-source-picker" disabled={disabled || !remoteMergeTarget}>
            <legend>Branches a integrar</legend>
            {!remoteMergeTarget && <p>Escolha primeiro a branch de destino.</p>}
            {remoteMergeTarget && remoteMergeOptions.length === 0 && <p>Não existem branches locais ou remotas com alterações por integrar.</p>}
            {remoteMergeTarget && remoteMergeOptions.length > 0 && <div className="git-remote-source-list">{remoteMergeOptions.map((branch) => {
              const selected = remoteMergeSources.includes(branch.name)
              return <label key={branch.name} className={`git-remote-source-option ${selected ? 'selected' : ''}`}>
                <input type="checkbox" checked={selected} onChange={() => toggleRemoteMergeSource(branch.name)} aria-label={`Integrar ${branch.name}`}/>
                <span className="git-remote-source-check"><Icon name={selected ? 'check' : 'git'} size={11}/></span>
                <span title={branch.name}>{branch.name} <small>{branch.remote ? `· remoto · ${branch.unmerged_commits || 0}` : `· local · ${branch.unmerged_commits || 0}`}</small></span>
              </label>
            })}</div>}
          </fieldset>
          <div className="git-remote-merge-footer">
            <p className="git-hint">Usa um worktree temporário; a branch local atual não é alternada.</p>
            <button type="button" className="git-action primary" disabled={disabled || !remoteMergeTarget || remoteMergeSources.length === 0} onClick={onRemoteMerge}><Icon name="network" size={13}/> Merge remoto ({remoteMergeSources.length})</button>
          </div>
        </div>
      </div>
    </div>

    <div className="git-branch-directory">
      <div className="git-branch-directory-heading">
        <div><span>Repositório</span><strong>Branches disponíveis</strong></div>
        <span>{localBranches.length + remoteBranches.length} no total</span>
      </div>
      <BranchList title="Locais" description="Branches disponíveis no workspace" branches={localBranches} disabled={disabled} allowCurrentSwitch={allowCurrentSwitch} onSwitch={onSwitch} onDelete={onDeleteBranch} onCopy={onCopyBranch}/>
      <BranchList title="Remotas" description="Referências conhecidas no servidor" branches={remoteBranches} disabled={disabled} allowCurrentSwitch={allowCurrentSwitch} onSwitch={onSwitch} onDelete={onDeleteBranch} onCopy={onCopyBranch}/>
    </div>

    <GitReleasePanel
      tags={tags} branches={remoteBranches} projectVersion={projectVersion} disabled={disabled}
      onCopyTag={onCopyTag} onGenerateReleaseNotes={onGenerateReleaseNotes} onCreateRelease={onCreateRelease}
    />

  </section>
}

function BranchList({ title, description, branches, disabled = false, allowCurrentSwitch = false, onSwitch, onDelete, onCopy }: { title: string; description: string; branches: GitBranch[]; disabled?: boolean; allowCurrentSwitch?: boolean; onSwitch?: (branch: string) => void; onDelete?: (branch: string) => void; onCopy: (branch: string) => void }) {
  return <div className="git-branch-group">
    <div className="git-branch-group-heading">
      <div className="git-branch-group-title"><span className="git-branch-group-icon"><Icon name="git" size={12}/></span><div><strong>{title}</strong><small>{description}</small></div></div>
      <span className="git-section-count">{branches.length}</span>
    </div>
    <ul className="git-branch-list">{branches.map((branch) => {
      const counterpartLabel = branch.remote ? (branch.has_counterpart ? `Existe localmente como ${branch.counterpart}` : 'Ainda não existe localmente') : (branch.has_counterpart ? `Existe remotamente como ${branch.counterpart}` : 'Ainda não existe remotamente')
      const counterpartText = branch.remote ? (branch.has_counterpart ? 'Local' : 'Sem local') : (branch.has_counterpart ? 'Remota' : 'Sem remota')
      const inSync = branch.ahead === 0 && branch.behind === 0
      const createsLocal = Boolean(branch.remote) && !branch.has_counterpart
      const switchLabel = createsLocal ? `Criar branch local a partir de ${branch.name}` : `Alternar para ${branch.name}`
      return <li key={branch.name} className={`${branch.current ? 'current' : ''} ${branch.remote ? 'remote' : ''}`}>
        <div className="git-branch-primary">
          <span className="git-branch-marker"><Icon name="git" size={12}/></span>
          <span className="git-branch-copy">
            <span className="git-branch-name" title={branch.name}>{branch.name}</span>
            {branch.subject && <span className="git-branch-subject" title={branch.subject}>{branch.subject}</span>}
          </span>
        </div>
        <div className="git-branch-row-meta">
          {branch.current && <span className="git-branch-current-badge">Atual</span>}
          <span className="git-branch-sync" aria-label={`Sincronização de ${branch.name}`}>
            {inSync && <span className="git-branch-state clean" title="Sem commits pendentes de sincronização"><Icon name="check" size={10}/><b>Em dia</b></span>}
            {branch.ahead > 0 && <span className="active outgoing" title={`${branch.ahead} commit(s) para enviar`}><Icon name="arrow-up" size={11}/><b>{branch.ahead}</b></span>}
            {branch.behind > 0 && <span className="active incoming" title={`${branch.behind} commit(s) para receber`}><Icon name="arrow-down" size={11}/><b>{branch.behind}</b></span>}
            <span className={`git-branch-counterpart ${branch.has_counterpart ? 'active' : ''}`} title={counterpartLabel} aria-label={counterpartLabel}><Icon name="link" size={10}/><b>{counterpartText}</b></span>
          </span>
          <button type="button" className="git-inline-copy git-branch-copy-action" aria-label={`Copiar nome da branch ${branch.name}`} title="Copiar nome da branch" onClick={() => onCopy(branch.name)}><Icon name="copy" size={11}/></button>
          {onSwitch && (!branch.current || allowCurrentSwitch) && <button type="button" className="git-action small git-branch-row-action git-branch-switch" disabled={disabled} onClick={() => onSwitch(branch.name)} aria-label={switchLabel} title={switchLabel}><Icon name={createsLocal ? 'plus' : 'arrow-right'} size={12}/></button>}
          {onDelete && !branch.current && <button type="button" className="git-action small danger git-branch-row-action git-branch-delete" disabled={disabled} onClick={() => onDelete(branch.name)} aria-label={`Remover branch ${branch.name}`} title={`Remover branch ${branch.name}`}><Icon name="trash" size={12}/></button>}
        </div>
      </li>
    })}</ul>
  </div>
}

function PendingSection({ pending, selected, disabled, hasIdentity, commitMode, onToggle, onCommitAll, onCommitSelected, onDiscard, onOpenDiff }: {
  pending: GitPendingCommit[]; selected: Set<string>; disabled: boolean; hasIdentity: boolean; commitMode: GitCommitMode
  onToggle: (id: string) => void; onCommitAll: () => void; onCommitSelected: () => void; onDiscard: (id: string) => void; onOpenDiff: (record: GitPendingCommit) => void
}) {
  return <section className="git-section git-wharnex-queue">
    <div className="git-section-heading"><div><span>Automação</span><strong>Registos Wharnex por commitar</strong></div><span className="git-section-count">{pending.length}</span></div>
    {pending.length === 0 && <p className="git-empty inline">{commitMode === 'manual' ? 'Não existem registos de aplicação à espera de commit.' : 'O projeto usa auto-commit, por isso não acumula registos de aplicação.'}</p>}
    {pending.length > 0 && <>
      <div className="git-row git-pending-actions">
        <button type="button" className="git-action primary" disabled={disabled || !hasIdentity} onClick={onCommitAll}><Icon name="check" size={13}/> Commitar todos</button>
        <button type="button" className="git-action" disabled={disabled || !hasIdentity || selected.size === 0} onClick={onCommitSelected}><Icon name="check" size={13}/> Selecionados ({selected.size})</button>
      </div>
      <ul className="git-pending-list">{pending.map((record) => <li key={record.id}>
        <label className="git-pending-head"><input type="checkbox" checked={selected.has(record.id)} disabled={disabled} onChange={() => onToggle(record.id)}/><span className="git-pending-subject">{record.subject}</span></label>
        <p className="git-pending-paths">{record.paths.join(', ')}</p>
        <div className="git-row"><button type="button" className="git-action small" disabled={disabled} onClick={() => onOpenDiff(record)}><Icon name="file" size={12}/> Ver diff</button><button type="button" className="git-action small danger" disabled={disabled} onClick={() => onDiscard(record.id)} title="Remove apenas o registo; os ficheiros ficam intactos"><Icon name="trash" size={12}/> Descartar registo</button></div>
      </li>)}</ul>
    </>}
  </section>
}


function DiffModal({ sessionId, record, onClose }: { sessionId: string; record: GitPendingCommit; onClose: () => void }) {
  return createPortal(<InternalWindow title={`Diff de ${record.subject}`} onClose={onClose} layerClassName="git-diff-backdrop">
    <div className="git-diff-modal" role="dialog" aria-modal="false" aria-label={`Diff de ${record.subject}`}>
      <header><div><span className="panel-kicker">Registo Wharnex</span><strong>{record.subject}</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar diff"><Icon name="close" size={13}/></button></header>
      <GitDiffReview sessionId={sessionId} diff={record.diff} emptyText="Sem diff registado."/>
      {record.diff_truncated && <p className="git-hint">O diff foi truncado para apresentação; o commit usa sempre o conteúdo atual dos ficheiros.</p>}
      <details className="git-message-preview"><summary>Mensagem de commit</summary><pre>{record.message}</pre></details>
    </div>
  </InternalWindow>, document.body)
}
