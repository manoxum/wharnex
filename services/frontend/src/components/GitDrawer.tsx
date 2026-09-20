import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitAuthorSettings, GitBranch, GitCommitDetail, GitCommitMode, GitConflictStrategy, GitFileDiff, GitOverview, GitPendingCommit, Session } from '../types'
import { api, APIError } from '../lib/api'
import { buildGitGraphRows, type GitGraphRow } from '../lib/gitGraph'
import { announceGitChanged, subscribeGitLiveSync } from '../lib/gitLiveSync'
import { confirmDialog } from '../lib/appDialog'
import { Icon } from './Icon'
import { GitUnpushedSection } from './GitUnpushedSection'
import { GitDiffReview } from './GitDiffReview'
import { GitOperationModal, type GitOperation } from './GitOperationModal'
import { GitContributorsSection } from './GitContributorsSection'

type GitTab = 'changes' | 'history' | 'contributors' | 'branches' | 'settings'
type GitChangesTab = 'working' | 'pending'

export function GitDrawer({ session, busy, onClose, onError, onSession, onResolveConflictWithGPT }: {
  session: Session
  busy: boolean
  onClose: () => void
  onError?: (message: string) => void
  onSession?: (session: Session) => void
  onResolveConflictWithGPT?: (session: Session) => Promise<void>
}) {
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)
  const [openDiff, setOpenDiff] = useState<GitPendingCommit | null>(null)
  const [worktreeDiff, setWorktreeDiff] = useState<GitFileDiff | null>(null)
  const [mergeRef, setMergeRef] = useState('')
  const [remoteMergeTarget, setRemoteMergeTarget] = useState('')
  const [remoteMergeSources, setRemoteMergeSources] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<GitTab>('changes')
  const [operation, setOperation] = useState<GitOperation | null>(null)
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
    const next = await api.gitOverview(session.id)
    setOverview(next)
    return next
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
  useEffect(() => subscribeGitLiveSync(session.id, () => { void refresh() }), [session.id, refresh])
  useEffect(() => {
    if (!overview) return
    const committable = new Set(overview.working.files.filter((file) => file.kind === 'change' || file.kind === 'gitlink').map((file) => file.path))
    setSelectedWorktree((currentSelection) => new Set(Array.from(currentSelection).filter((path) => committable.has(path))))
  }, [overview])

  const localBranches = useMemo(() => (overview?.branches || []).filter((branch) => !branch.remote), [overview])
  const remoteBranches = useMemo(() => (overview?.branches || []).filter((branch) => branch.remote), [overview])
  const current = useMemo(() => localBranches.find((branch) => branch.current), [localBranches])
  const pending = overview?.pending || []

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

  async function runGitOperation(title: string, detail: string, action: () => Promise<string>, syncSession = false) {
    let phase: 'running' | 'refreshing' = 'running'
    let actionMessage = ''
    setWorking(true)
    setNotice('')
    setNoticeError(false)
    setOperation({ title, detail, phase })
    try {
      actionMessage = await action()
      phase = 'refreshing'
      setOperation({ title, detail, phase })
      await loadOverview()
      announceGitChanged(session.id)
      if (syncSession && onSession) onSession(await api.getSession(session.id))
      setNotice(actionMessage)
      setOperation({ title, detail, phase: 'success', message: actionMessage })
      return true
    } catch (error) {
      const cause = error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
      const message = phase === 'refreshing' && actionMessage ? `${actionMessage} Não foi possível atualizar o painel: ${cause}` : cause
      report(error)
      setOperation({ title, detail, phase: 'error', message, failedPhase: phase })
      return false
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

  async function conflictMessage(conflictID: string | undefined, context: string) {
    if (!conflictID) return context
    const strategy = overview?.conflict_strategy || 'user_decide'
    if (strategy === 'gpt_only') {
      const updated = await api.delegateConflictToGPT(session.id, [], '')
      onSession?.(updated)
      await onResolveConflictWithGPT?.(updated)
      return `${context} O conflito foi delegado automaticamente ao GPT.`
    }
    if (strategy === 'user_only') return `${context} A estratégia deste projeto exige resolução manual pelo utilizador.`
    return `${context} Escolha no chat se pretende resolver manualmente ou delegar ao GPT.`
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
    await runGitOperation(
      ids.length ? 'A criar commits selecionados' : 'A criar commits',
      ids.length ? `${ids.length} registo(s) selecionado(s) serão adicionados ao histórico local.` : 'A fila pendente será registada no histórico local.',
      async () => {
        const result = await api.commitGitPending(session.id, ids)
        setSelected(new Set())
        const made = result.outcomes.filter((outcome) => outcome.commit_sha).length
        const skipped = result.outcomes.filter((outcome) => outcome.skipped).length
        return `${made} commit(s) criado(s)${skipped ? `, ${skipped} registo(s) obsoleto(s) retirado(s)` : ''}.`
      },
    )
  }

  async function commitWorktree() {
    const paths = Array.from(selectedWorktree)
    await runGitOperation(
      'A criar commit manual',
      `${paths.length} ficheiro(s) selecionado(s) serão adicionados ao histórico local.`,
      async () => {
        const result = await api.commitGitWorktree(session.id, worktreeCommitMessage, paths)
        setSelectedWorktree(new Set())
        setWorktreeCommitMessage('')
        return `Commit criado com ${result.paths.length} ficheiro(s): ${result.commit_sha.slice(0, 8)}.`
      },
    )
  }

  return <section className="git-drawer" aria-label="Git do projeto">
    <header className="agent-drawer-heading git-drawer-heading">
      <div className="git-heading-copy">
        <span className="panel-kicker">Controlo de versão</span>
        <strong>Git do projeto</strong>
        {overview?.available && <span className="git-heading-branch"><Icon name="git" size={12}/>{overview.detached ? 'HEAD destacado' : current?.name || overview.current_branch || 'sem branch'}</span>}
      </div>
      <div className="git-heading-actions">
        <button type="button" className="agent-drawer-icon" disabled={disabled} onClick={() => void refresh()} aria-label="Atualizar estado do Git"><Icon name="refresh" size={13}/></button>
        <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar Git"><Icon name="close" size={13}/></button>
      </div>
    </header>

    {loading && <p className="git-empty">A ler o estado do repositório…</p>}
    {!loading && overview && !overview.available && <p className="git-empty warning-card">Não foi possível inspecionar o repositório: {overview.unavailable}</p>}

    {overview?.available && <>
      <GitTabs active={activeTab} onChange={setActiveTab} overview={overview}/>
      {notice && <p className={`git-notice ${noticeError ? 'error-card' : ''}`} role={noticeError ? 'alert' : 'status'}>{notice}</p>}
      {overview.conflict && <div className="git-conflict-card warning-card">
        <strong>Conflito de Git em resolução</strong>
        <p>A integrar <code>{overview.conflict.ref}</code>. A resolução está no chat e o merge será concluído localmente quando chegar.</p>
      </div>}
      {overview.in_progress && <p className="git-notice warning-card">Há um <strong>{overview.in_progress}</strong> em curso no host. Termine-o ou aborte-o antes de aplicar ou fazer merge.</p>}

      <div className="git-tab-content" role="tabpanel" aria-label={gitTabLabel(activeTab)}>
        {activeTab === 'changes' && <>
          <ChangesTabs
            active={activeChangesTab}
            workingCount={overview.working.files.length}
            pendingCount={unpushedCount(overview)}
            onChange={setActiveChangesTab}
          />
          {activeChangesTab === 'working' && <WorktreeFiles
            overview={overview} disabled={disabled} hasIdentity={overview.has_identity}
            selected={selectedWorktree} message={worktreeCommitMessage}
            onMessageChange={setWorktreeCommitMessage}
            onToggle={(path) => setSelectedWorktree((currentSelection) => {
              const next = new Set(currentSelection)
              if (next.has(path)) next.delete(path)
              else next.add(path)
              return next
            })}
            onCommit={() => void commitWorktree()}
            onOpenDiff={(path) => void (async () => {
              try { setWorktreeDiff(await api.gitFileDiff(session.id, path)) } catch (error) { report(error) }
            })()}
          />}
          {activeChangesTab === 'pending' && <GitUnpushedSection
            sessionId={session.id} activeBranch={current} remotes={overview.remotes} disabled={disabled}
            onFullPush={async (remote, branch, setUpstream) => {
              await runGitOperation(
                'A publicar alterações',
                `A enviar ${branch} para ${remote}${setUpstream ? ' e a configurar o upstream' : ''}.`,
                async () => {
                  const result = await api.gitPush(session.id, remote, branch, setUpstream)
                  return result.conflict_id ? conflictMessage(result.conflict_id, pushMessage(result.outcome, result.integrated, result.conflict_id)) : pushMessage(result.outcome, result.integrated, result.conflict_id)
                },
                true,
              )
            }}
            onSelectedPush={async (commitSHAs) => {
              await runGitOperation(
                'A publicar commits selecionados',
                `A enviar ${commitSHAs.length} commit(s) para o upstream da branch atual.`,
                async () => {
                  const result = await api.gitPushSelected(session.id, commitSHAs)
                  return result.conflict_id ? conflictMessage(result.conflict_id, pushMessage(result.outcome, result.integrated, result.conflict_id)) : pushMessage(result.outcome, result.integrated, result.conflict_id)
                },
              )
            }}
          />}
        </>}
        {activeTab === 'history' && <HistorySection sessionId={session.id} branches={overview.branches}/>}
        {activeTab === 'contributors' && <GitContributorsSection sessionId={session.id}/>}
        {activeTab === 'branches' && <BranchSection
          sessionId={session.id}
          current={current?.name || overview.current_branch} detached={overview.detached}
          localBranches={localBranches} remoteBranches={remoteBranches} remotes={overview.remotes}
          disabled={disabled} mergeRef={mergeRef} onMergeRefChange={setMergeRef}
          remoteMergeTarget={remoteMergeTarget} remoteMergeSources={remoteMergeSources}
          onRemoteMergeTargetChange={setRemoteMergeTarget} onRemoteMergeSourcesChange={setRemoteMergeSources}
          onRemoteMerge={() => runGitOperation(
            'A integrar branches remotas',
            `A integrar ${remoteMergeSources.join(', ')} em ${remoteMergeTarget} sem alterar a branch local.`,
            async () => {
              const result = await api.gitRemoteMerge(session.id, remoteMergeTarget, remoteMergeSources)
              if (result.outcome === 'conflict') return conflictMessage(result.conflict_id, `Merge remoto encontrou conflito em ${result.conflict_ref}; nenhuma branch local ou remota foi alterada.`)
              setRemoteMergeSources([])
              return `Merge remoto em ${result.target_ref}: ${result.outcome}${result.push_outcome ? ` · push ${result.push_outcome}` : ''}.`
            },
            true,
          )}
          onMerge={() => runGitOperation(
            'A integrar branch',
            `A fazer merge de ${mergeRef} na branch atual.`,
            async () => {
              const result = await api.gitMerge(session.id, mergeRef)
              setMergeRef('')
              return result.conflict_id ? conflictMessage(result.conflict_id, `Merge de ${result.ref} entrou em conflito.`) : `Merge de ${result.ref}: ${result.outcome}.`
            },
            true,
          )}
          onFetch={(remote) => runGitOperation(
            'A procurar alterações na origem',
            `A atualizar as referências remotas a partir de ${remote}.`,
            async () => {
              await api.gitFetch(session.id, remote)
              return `Fetch de ${remote} concluído.`
            },
          )}
          onPull={(remote, branch) => runGitOperation(
            'A integrar alterações da origem',
            `A trazer ${remote}/${branch} para a branch local.`,
            async () => {
              const result = await api.gitPull(session.id, remote, branch)
              return result.conflict_id ? conflictMessage(result.conflict_id, `Pull de ${result.ref} encontrou conflito.`) : `Pull de ${result.ref}: ${result.outcome}.`
            },
            true,
          )}
          onSwitch={(branch) => run(async () => {
            await api.gitSwitch(session.id, branch)
            setNotice(`Branch alterada para ${branch}.`)
          }, true)}
          onCreateBranch={(branch, startPoint) => run(async () => {
            await api.gitCreateBranch(session.id, branch, startPoint)
            setNotice(`Branch ${branch} criada a partir de ${startPoint || 'HEAD'}.`)
          })}
          onDeleteBranch={(branch) => void (async () => {
            const confirmed = await confirmDialog({ title: `Remover branch ${branch}?`, message: 'Branches locais usam remoção segura sem força; branches remotas são removidas do remoto selecionado sem force push.', tone: 'danger', confirmLabel: 'Remover branch' })
            if (!confirmed) return
            await run(async () => { await api.gitDeleteBranch(session.id, branch); setNotice(`Branch ${branch} removida.`) })
          })()}
          onCopyBranch={(branch) => void copyGitText(branch, `Nome da branch ${branch} copiado.`)}
          onGenerateReleaseNotes={async (branch) => (await api.gitGenerateReleaseNotes(session.id, branch)).body}
          onCreateRelease={(input) => runGitOperation(
            'A publicar release',
            `A criar ${input.tag} a partir de ${input.branch} e a publicar a release em ${input.remote}.`,
            async () => {
              const result = await api.gitCreateRelease(session.id, input)
              return `Release ${result.tag} publicada${result.release_url ? ` · ${result.release_url}` : ''}.`
            },
          )}
          onPush={(remote, branch, setUpstream) => runGitOperation(
            'A publicar alterações',
            `A enviar ${branch} para ${remote}${setUpstream ? ' e a configurar o upstream' : ''}.`,
            async () => {
              const result = await api.gitPush(session.id, remote, branch, setUpstream)
              return result.conflict_id ? conflictMessage(result.conflict_id, pushMessage(result.outcome, result.integrated, result.conflict_id)) : pushMessage(result.outcome, result.integrated, result.conflict_id)
            },
            true,
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
      </div>
    </>}

    {openDiff && <DiffModal sessionId={session.id} record={openDiff} onClose={() => setOpenDiff(null)} />}
    {worktreeDiff && <WorktreeDiffModal sessionId={session.id} file={worktreeDiff} onClose={() => setWorktreeDiff(null)}/>}
    {operation && <GitOperationModal operation={operation} onClose={() => setOperation(null)}/>}
  </section>
}

function gitTabLabel(tab: GitTab) {
  return ({ changes: 'Alterações', history: 'Histórico', contributors: 'Contribuidores', branches: 'Branches', settings: 'Definições' } as const)[tab]
}

function GitTabs({ active, onChange, overview }: { active: GitTab; onChange: (tab: GitTab) => void; overview: GitOverview }) {
  const localChanges = overview.working.files?.length || overview.working.stageable_count
  const current = overview.branches.find((branch) => !branch.remote && branch.current)
  const unpublished = current?.has_upstream && !current.gone
    ? current.ahead
    : overview.commits.filter((commit) => !commit.pushed).length
  const changes = localChanges + unpublished
  const tabs: Array<{ id: GitTab; icon: 'edit' | 'git' | 'agent' | 'bridge' | 'settings'; count?: number }> = [
    { id: 'changes', icon: 'edit', count: changes },
    { id: 'history', icon: 'git', count: overview.commits.length },
    { id: 'contributors', icon: 'agent' },
    { id: 'branches', icon: 'bridge', count: overview.branches.length },
    { id: 'settings', icon: 'settings' },
  ]
  return <nav className="git-tabs" role="tablist" aria-label="Secções do Git">
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} onClick={() => onChange(tab.id)}>
      <Icon name={tab.icon} size={13}/><span>{gitTabLabel(tab.id)}</span>{typeof tab.count === 'number' && <span className="git-tab-count">{tab.count}</span>}
    </button>)}
  </nav>
}

function ChangesTabs({ active, workingCount, pendingCount, onChange }: {
  active: GitChangesTab; workingCount: number; pendingCount: number; onChange: (tab: GitChangesTab) => void
}) {
  return <nav className="git-changes-tabs" role="tablist" aria-label="Tipos de alterações locais">
    <button type="button" role="tab" aria-selected={active === 'working'} className={active === 'working' ? 'active' : ''} onClick={() => onChange('working')}>
      <Icon name="edit" size={12}/><span>Alterações pendentes</span><span className="git-tab-count">{workingCount}</span>
    </button>
    <button type="button" role="tab" aria-selected={active === 'pending'} className={active === 'pending' ? 'active' : ''} onClick={() => onChange('pending')}>
      <Icon name="clipboard" size={12}/><span>Commits pendentes</span><span className="git-tab-count">{pendingCount}</span>
    </button>
  </nav>
}

function WorktreeFiles({ overview, disabled, hasIdentity, selected, message, onMessageChange, onToggle, onCommit, onOpenDiff }: {
  overview: GitOverview; disabled: boolean; hasIdentity: boolean; selected: Set<string>; message: string
  onMessageChange: (value: string) => void; onToggle: (path: string) => void; onCommit: () => void; onOpenDiff: (path: string) => void
}) {
  const files = overview.working.files || []
  const canCommit = (kind: GitOverview['working']['files'][number]['kind']) => kind === 'change' || kind === 'gitlink'
  const committableCount = files.filter((file) => canCommit(file.kind)).length
  return <section className="git-change-surface git-worktree-files-section">
    <div className="git-change-surface-heading">
      <div><span>Worktree</span><strong>{files.length ? 'Alterações locais' : 'Worktree limpo'}</strong></div>
      <span className="git-section-count">{files.length}</span>
    </div>
    {files.length === 0 ? <div className="git-clean-state"><span><Icon name="check" size={13}/></span><div><strong>Sem alterações por commitar</strong><small>O worktree está sincronizado com o último commit local.</small></div></div> : <>
      <ul className="git-worktree-files">{files.map((file) => {
        const diffable = file.kind !== 'submodule' && file.kind !== 'embedded_repository'
        const committable = canCommit(file.kind)
        return <li key={`${file.kind}:${file.path}`}>
          <label className="git-worktree-file-select" title={committable ? 'Selecionar ficheiro para commit' : 'Este tipo de entrada não pode ser commitado daqui'}>
            <input type="checkbox" checked={selected.has(file.path)} disabled={disabled || !committable} aria-label={`Selecionar ${file.path}`} onChange={() => onToggle(file.path)}/>
          </label>
          <span className="git-worktree-file-icon"><Icon name={file.kind === 'unmerged' ? 'alert' : 'file'} size={12}/></span>
          <span className="git-worktree-file-copy"><strong title={file.path}>{file.path}</strong><small>{worktreeKind(file.kind)}</small></span>
          <button type="button" className="git-file-diff-action git-line-stats" disabled={disabled || !diffable} title={diffable ? 'Ver alterações deste ficheiro' : 'Este tipo de entrada não tem diff inline'} aria-label={`Abrir diff de ${file.path}`} onClick={() => onOpenDiff(file.path)}><b>+{file.additions || 0}</b><i>−{file.deletions || 0}</i></button>
        </li>
      })}</ul>
      {committableCount > 0 && <div className="git-worktree-commit">
        <label><span>Mensagem do commit</span><input type="text" value={message} disabled={disabled || !hasIdentity} onChange={(event) => onMessageChange(event.target.value)} placeholder="ex.: fix(ui): ajustar painel Git"/></label>
        <button type="button" className="git-action primary" disabled={disabled || !hasIdentity || selected.size === 0 || !message.trim()} onClick={onCommit}><Icon name="check" size={13}/> Commitar ({selected.size})</button>
      </div>}
      {!hasIdentity && committableCount > 0 && <p className="git-hint warning-card">Configure <code>user.name</code> e <code>user.email</code> para criar commits manuais.</p>}
    </>}
  </section>
}


function worktreeKind(kind: GitOverview['working']['files'][number]['kind']) {
  return ({ change: 'alterado', gitlink: 'gitlink alterado', submodule: 'submódulo com alterações', embedded_repository: 'repositório embebido', unmerged: 'conflito não resolvido' } as const)[kind]
}

function unpushedCount(overview: GitOverview) {
  const current = overview.branches.find((branch) => !branch.remote && branch.current)
  if (current?.has_upstream && !current.gone) return current.ahead
  return overview.commits.filter((commit) => !commit.pushed).length
}

function pushMessage(outcome: string, integrated?: boolean, conflictID?: string) {
  if (conflictID) return 'O remoto tinha trabalho que entrou em conflito; escolha resolução manual ou GPT no chat. Nada foi publicado.'
  switch (outcome) {
    case 'pushed': return integrated ? 'Trabalho do remoto integrado e push concluído.' : 'Push concluído.'
    case 'up_to_date': return 'O remoto já estava atualizado.'
    case 'auth_required': return 'O Git no host não conseguiu autenticar no remoto. Confirme as credenciais ou o credential helper da sessão do host e repita.'
    case 'rejected': return 'O remoto rejeitou o push e a integração automática não foi possível.'
    default: return `Push: ${outcome}.`
  }
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

type GitReleaseDraftInput = { remote: string; branch: string; tag: string; title: string; body: string }

function BranchSection({ sessionId, current, detached, localBranches, remoteBranches, remotes, disabled, mergeRef, onMergeRefChange, onMerge, remoteMergeTarget, remoteMergeSources, onRemoteMergeTargetChange, onRemoteMergeSourcesChange, onRemoteMerge, onFetch, onPull, onSwitch, onCreateBranch, onDeleteBranch, onCopyBranch, onGenerateReleaseNotes, onCreateRelease, onPush }: {
  sessionId: string; current?: string; detached: boolean; localBranches: GitOverview['branches']; remoteBranches: GitOverview['branches']; remotes: GitOverview['remotes']
  disabled: boolean; mergeRef: string; onMergeRefChange: (value: string) => void; onMerge: () => void
  remoteMergeTarget: string; remoteMergeSources: string[]; onRemoteMergeTargetChange: (value: string) => void; onRemoteMergeSourcesChange: (values: string[]) => void; onRemoteMerge: () => void
  onFetch: (remote: string) => void; onPull: (remote: string, branch: string) => void; onSwitch: (branch: string) => void
  onCreateBranch: (branch: string, startPoint: string) => void; onDeleteBranch: (branch: string) => void; onCopyBranch: (branch: string) => void
  onGenerateReleaseNotes: (branch: string) => Promise<string>; onCreateRelease: (input: GitReleaseDraftInput) => Promise<boolean>
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
  const [releaseBranch, setReleaseBranch] = useState('')
  const [releaseRemote, setReleaseRemote] = useState(remotes[0]?.name || '')
  const [releaseTag, setReleaseTag] = useState('')
  const [releaseTitle, setReleaseTitle] = useState('')
  const [releaseBody, setReleaseBody] = useState('')
  const [releaseMode, setReleaseMode] = useState<'manual' | 'gpt'>('manual')
  const [releaseGenerating, setReleaseGenerating] = useState(false)
  const [releaseError, setReleaseError] = useState('')
  useEffect(() => { if (current) setNewBranchBase((value) => value === 'HEAD' || !value ? current : value) }, [current])
  useEffect(() => { if (!releaseRemote && remotes[0]?.name) setReleaseRemote(remotes[0].name) }, [releaseRemote, remotes])
  useEffect(() => {
    let alive = true
    if (!current || detached) { setLocalMergeOptions([]); return () => { alive = false } }
    api.gitMergeCandidates(sessionId, current).then((items) => { if (alive) setLocalMergeOptions(items) }).catch(() => { if (alive) setLocalMergeOptions([]) })
    return () => { alive = false }
  }, [sessionId, current, detached, localBranches, remoteBranches])
  useEffect(() => {
    let alive = true
    if (!remoteMergeTarget) { setRemoteMergeOptions([]); return () => { alive = false } }
    api.gitMergeCandidates(sessionId, remoteMergeTarget).then((items) => {
      if (!alive) return
      setRemoteMergeOptions(items)
      const eligible = new Set(items.map((item) => item.name))
      onRemoteMergeSourcesChange(remoteMergeSources.filter((ref) => eligible.has(ref)))
    }).catch(() => { if (alive) setRemoteMergeOptions([]) })
    return () => { alive = false }
  }, [sessionId, remoteMergeTarget, localBranches, remoteBranches])
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
      <BranchList title="Locais" description="Branches disponíveis no workspace" branches={localBranches} disabled={disabled} onSwitch={onSwitch} onDelete={onDeleteBranch} onCopy={onCopyBranch}/>
      <BranchList title="Remotas" description="Referências conhecidas no servidor" branches={remoteBranches} disabled={disabled} onSwitch={onSwitch} onDelete={onDeleteBranch} onCopy={onCopyBranch}/>
    </div>

    <GitReleaseSection
      branches={localBranches} remotes={remotes} disabled={disabled}
      branch={releaseBranch} remote={releaseRemote} tag={releaseTag} title={releaseTitle} body={releaseBody} mode={releaseMode}
      generating={releaseGenerating} error={releaseError}
      onBranch={setReleaseBranch} onRemote={setReleaseRemote} onTag={setReleaseTag} onTitle={setReleaseTitle} onBody={setReleaseBody}
      onMode={(mode) => { setReleaseMode(mode); setReleaseError(''); setReleaseBody('') }}
      onGenerate={async () => {
        if (!releaseBranch) return
        setReleaseGenerating(true); setReleaseError('')
        try { setReleaseBody(await onGenerateReleaseNotes(releaseBranch)) }
        catch (error) { setReleaseError(error instanceof Error ? error.message : String(error)) }
        finally { setReleaseGenerating(false) }
      }}
      onPublish={async () => {
        setReleaseError('')
        const confirmed = await confirmDialog({ title: `Publicar ${releaseTag}?`, message: `Será criada a tag em ${releaseBranch} e uma release pública no remoto ${releaseRemote}.`, tone: 'warning', confirmLabel: 'Criar tag e release' })
        if (!confirmed) return
        const ok = await onCreateRelease({ remote: releaseRemote, branch: releaseBranch, tag: releaseTag.trim(), title: releaseTitle.trim(), body: releaseBody.trim() })
        if (ok) { setReleaseTag(''); setReleaseTitle(''); setReleaseBody('') }
      }}
    />
  </section>
}

function BranchList({ title, description, branches, disabled = false, onSwitch, onDelete, onCopy }: { title: string; description: string; branches: GitBranch[]; disabled?: boolean; onSwitch?: (branch: string) => void; onDelete?: (branch: string) => void; onCopy: (branch: string) => void }) {
  return <div className="git-branch-group">
    <div className="git-branch-group-heading">
      <div className="git-branch-group-title"><span className="git-branch-group-icon"><Icon name="git" size={12}/></span><div><strong>{title}</strong><small>{description}</small></div></div>
      <span className="git-section-count">{branches.length}</span>
    </div>
    <ul className="git-branch-list">{branches.map((branch) => {
      const counterpartLabel = branch.remote ? (branch.has_counterpart ? `Existe localmente como ${branch.counterpart}` : 'Ainda não existe localmente') : (branch.has_counterpart ? `Existe remotamente como ${branch.counterpart}` : 'Ainda não existe remotamente')
      const counterpartText = branch.remote ? (branch.has_counterpart ? 'Local' : 'Sem local') : (branch.has_counterpart ? 'Remota' : 'Sem remota')
      const inSync = branch.ahead === 0 && branch.behind === 0
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
          {onSwitch && !branch.current && <button type="button" className="git-action small git-branch-switch" disabled={disabled} onClick={() => onSwitch(branch.name)}>{branch.remote && !branch.has_counterpart ? 'Criar local' : 'Alternar'}</button>}
          {onDelete && !branch.current && <button type="button" className="git-action small danger git-branch-delete" disabled={disabled} onClick={() => onDelete(branch.name)}>Remover</button>}
        </div>
      </li>
    })}</ul>
  </div>
}

function GitReleaseSection({ branches, remotes, disabled, branch, remote, tag, title, body, mode, generating, error, onBranch, onRemote, onTag, onTitle, onBody, onMode, onGenerate, onPublish }: {
  branches: GitBranch[]; remotes: GitOverview['remotes']; disabled: boolean
  branch: string; remote: string; tag: string; title: string; body: string; mode: 'manual' | 'gpt'; generating: boolean; error: string
  onBranch: (value: string) => void; onRemote: (value: string) => void; onTag: (value: string) => void; onTitle: (value: string) => void; onBody: (value: string) => void
  onMode: (value: 'manual' | 'gpt') => void; onGenerate: () => Promise<void>; onPublish: () => Promise<void>
}) {
  const canPublish = Boolean(branch && remote && tag.trim() && body.trim())
  return <div className="git-release-panel">
    <div className="git-branch-operations-heading">
      <div><span>Publicação</span><strong>Tag e release no GitHub</strong></div>
      <small>Seleciona explicitamente a branch que ficará associada à release.</small>
    </div>
    <div className="git-release-grid">
      <label><span>Branch *</span><select aria-label="Branch da release" value={branch} disabled={disabled} onChange={(event) => { onBranch(event.target.value); onBody('') }}><option value="">Selecionar branch…</option>{branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      <label><span>Remoto</span><select aria-label="Remoto da release" value={remote} disabled={disabled} onChange={(event) => onRemote(event.target.value)}><option value="">Selecionar remoto…</option>{remotes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      <label><span>Tag *</span><input aria-label="Tag da release" value={tag} disabled={disabled} onChange={(event) => onTag(event.target.value)} placeholder="v1.3.0"/></label>
      <label><span>Título</span><input aria-label="Título da release" value={title} disabled={disabled} onChange={(event) => onTitle(event.target.value)} placeholder="Opcional · usa a tag se vazio"/></label>
    </div>
    <div className="git-release-mode" role="group" aria-label="Modo das notas de release">
      <button type="button" className={mode === 'manual' ? 'active' : ''} disabled={disabled} onClick={() => onMode('manual')}>Escrever manualmente</button>
      <button type="button" className={mode === 'gpt' ? 'active' : ''} disabled={disabled} onClick={() => onMode('gpt')}>Gerar com GPT</button>
    </div>
    {mode === 'manual' ? <GitReleaseRichText value={body} disabled={disabled} onChange={onBody}/> : <div className="git-release-gpt">
      <button type="button" className="git-action" disabled={disabled || generating || !branch} onClick={() => void onGenerate()}>{generating ? 'A gerar…' : 'Gerar notas da branch'}</button>
      <textarea aria-label="Notas de release geradas pelo GPT" value={body} disabled={disabled || generating} onChange={(event) => onBody(event.target.value)} placeholder={branch ? 'O GPT irá resumir os commits recentes desta branch.' : 'Seleciona primeiro uma branch.'}/>
      <p className="git-hint">O GPT gera apenas as notas; podes revê-las antes de publicar.</p>
    </div>}
    {error && <p className="git-notice error-card" role="alert">{error}</p>}
    <div className="git-release-footer"><span>A tag é criada no commit da branch selecionada e enviada sem force.</span><button type="button" className="git-action primary" disabled={disabled || generating || !canPublish} onClick={() => void onPublish()}>Criar tag e release</button></div>
  </div>
}

function GitReleaseRichText({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const editor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = value
  }, [value])
  const format = (command: string) => {
    if (disabled) return
    editor.current?.focus()
    document.execCommand?.(command, false)
    onChange(editor.current?.innerHTML || '')
  }
  return <div className="git-release-editor">
    <div className="git-release-toolbar" role="toolbar" aria-label="Formatação das notas de release">
      <button type="button" disabled={disabled} onClick={() => format('bold')} aria-label="Negrito"><strong>B</strong></button>
      <button type="button" disabled={disabled} onClick={() => format('italic')} aria-label="Itálico"><em>I</em></button>
      <button type="button" disabled={disabled} onClick={() => format('insertUnorderedList')} aria-label="Lista">• Lista</button>
    </div>
    <div ref={editor} className="git-release-editable" contentEditable={!disabled} role="textbox" aria-multiline="true" aria-label="Texto manual da release" data-placeholder="Descreve as mudanças desta release…" onInput={(event) => onChange(event.currentTarget.innerHTML)} suppressContentEditableWarning/>
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

function HistorySection({ sessionId, branches }: { sessionId: string; branches: GitOverview['branches'] }) {
  const [mode, setMode] = useState<'current' | 'selected' | 'all'>('current')
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<GitOverview['commits']>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const refsKey = Array.from(selectedRefs).sort().join('\u0000')

  const loadPage = useCallback(async (reset: boolean) => {
    if (loading || (!reset && !hasMore)) return
    setLoading(true); setError('')
    try {
      const next = await api.gitHistoryPage(sessionId, mode === 'selected' ? Array.from(selectedRefs) : [], mode === 'all', reset ? 0 : offset, 50)
      setHistory((current) => reset ? next.commits : [...current, ...next.commits])
      setOffset(next.next_offset); setHasMore(next.has_more)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }, [sessionId, mode, refsKey, offset, hasMore, loading])

  useEffect(() => {
    setHistory([]); setOffset(0); setHasMore(true); setDetail(null); setLoading(true)
    void api.gitHistoryPage(sessionId, mode === 'selected' ? Array.from(selectedRefs) : [], mode === 'all', 0, 50)
      .then((next) => { setHistory(next.commits); setOffset(next.next_offset); setHasMore(next.has_more); setError('') })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false))
  }, [sessionId, mode, refsKey])

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore || history.length === 0 || loading) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadPage(false) }, { rootMargin: '180px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, history.length, loading, loadPage])

  function selectRefs(values: string[]) { setSelectedRefs(new Set(values)); setMode('selected') }
  async function openCommit(sha: string) { try { setDetail(await api.gitHistoryCommit(sessionId, sha)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }

  const rows = buildGitGraphRows(history)
  const refsBySHA = new Map<string, GitBranch[]>()
  for (const branch of branches) refsBySHA.set(branch.commit_sha, [...(refsBySHA.get(branch.commit_sha) || []), branch])
  return <section className="git-section git-history-section">
    <div className="git-section-heading"><div><span>Timeline</span><strong>Histórico de commits</strong></div><span className="git-section-count">{history.length}{hasMore ? '+' : ''}</span></div>
    <div className="git-history-scope" role="group" aria-label="Âmbito do histórico">
      <button type="button" className={mode === 'current' ? 'active' : ''} onClick={() => setMode('current')}>Branch atual</button>
      <button type="button" className={mode === 'selected' ? 'active' : ''} onClick={() => setMode('selected')}>Selecionadas {selectedRefs.size ? `(${selectedRefs.size})` : ''}</button>
      <button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>Todas</button>
    </div>
    <label className="git-history-branch-picker"><span>Branches específicas <small>{selectedRefs.size ? `${selectedRefs.size} selecionada(s)` : 'Selecione uma ou mais'}</small></span><select multiple value={Array.from(selectedRefs)} aria-label="Branches do histórico" onChange={(event) => selectRefs(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.current ? ' · atual' : ''}</option>)}</select></label>
    {error && <p className="git-notice warning-card">{error}</p>}
    {!loading && history.length === 0 && <p className="git-empty inline">Sem commits para o âmbito selecionado.</p>}
    <ul className="git-commit-list">{rows.map((row) => <li key={row.commit.sha} className="git-history-row">
      <CommitGraph row={row}/>
      <button type="button" className="git-history-copy git-history-open" onClick={() => void openCommit(row.commit.sha)}>
        <div className="git-history-subject-line"><span className="git-commit-subject">{row.commit.subject}</span>{(refsBySHA.get(row.commit.sha) || []).slice(0, 3).map((branch) => <span key={branch.name} className={`git-ref-badge ${branch.current ? 'current' : ''}`}>{branch.current && <Icon name="git" size={10}/>} {branch.name}</span>)}</div>
        <div className="git-history-details"><span>{row.commit.author_name}</span><time dateTime={row.commit.committed_at}>{formatCommitDate(row.commit.committed_at)}</time></div>
      </button>
      <div className="git-history-tail">
        <span className="git-commit-meta"><code>{row.commit.short_sha}</code>{row.commit.wharnex && <span className="git-commit-tag" title="Originado por uma alteração do Wharnex">WHX</span>}{row.commit.merge && <span className="git-commit-tag">merge</span>}{!row.commit.pushed && <span className="git-commit-tag local">local</span>}</span>
        <button type="button" className="git-file-diff-action git-line-stats" aria-label={`Abrir diff do commit ${row.commit.short_sha}`} onClick={() => void openCommit(row.commit.sha)}><b>+{row.commit.additions || 0}</b><i>−{row.commit.deletions || 0}</i></button>
      </div>
    </li>)}</ul>
    <div ref={sentinel} className="git-history-sentinel" aria-hidden="true">{loading ? 'A carregar mais…' : hasMore ? '' : history.length ? 'Fim do histórico' : ''}</div>
    {detail && <HistoryCommitDetailModal sessionId={sessionId} detail={detail} onClose={() => setDetail(null)}/>}
  </section>
}

function HistoryCommitDetailModal({ sessionId, detail, onClose }: { sessionId: string; detail: GitCommitDetail; onClose: () => void }) {
  const commit = detail.commit
  return createPortal(<div className="git-diff-backdrop" onMouseDown={onClose}>
    <div className="git-diff-modal git-commit-detail-modal git-history-commit-modal" role="dialog" aria-modal="true" aria-label={`Commit ${commit.short_sha}`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="git-history-commit-header">
        <div className="git-history-commit-heading">
          <span className="git-history-commit-icon"><Icon name="git" size={15}/></span>
          <div className="git-history-commit-copy">
            <span className="git-history-commit-eyebrow"><span className="panel-kicker">Histórico Git</span><code>{commit.short_sha}</code></span>
            <strong>{commit.subject}</strong>
            <span className="git-history-commit-byline"><span>{commit.author_name}</span><time dateTime={commit.committed_at}>{formatCommitDate(commit.committed_at)}</time></span>
          </div>
        </div>
        <div className="git-history-commit-actions">
          <div className="git-history-commit-stats" role="group" aria-label="Resumo do commit">
            <span className="git-history-commit-stat additions"><b>+{commit.additions || 0}</b><small>adições</small></span>
            <span className="git-history-commit-stat deletions"><b>−{commit.deletions || 0}</b><small>remoções</small></span>
            <span className="git-history-commit-stat files"><b>{commit.files_changed || 0}</b><small>ficheiro(s)</small></span>
          </div>
          <button type="button" className="agent-drawer-icon git-history-commit-close" onClick={onClose} aria-label="Fechar detalhes"><Icon name="close" size={13}/></button>
        </div>
      </header>
      <details className="git-commit-detail-disclosure git-history-commit-disclosure">
        <summary><span>Detalhes do commit</span><code>{commit.short_sha}</code></summary>
        <div className="git-commit-detail-meta">
          <span><strong>SHA</strong><code>{commit.sha}</code></span>
          <span><strong>Autor</strong>{commit.author_name} &lt;{commit.author_email}&gt;</span>
          <span><strong>Data</strong><time dateTime={commit.committed_at}>{formatCommitDate(commit.committed_at)}</time></span>
          <span><strong>Pais</strong><code>{commit.parents.length ? commit.parents.join(', ') : 'commit inicial'}</code></span>
          {commit.request_id && <span><strong>Request</strong><code>{commit.request_id}</code></span>}
          {commit.plan_id && <span><strong>Plano</strong><code>{commit.plan_id}</code></span>}
        </div>
        {(commit.body || commit.subject) && <pre className="git-commit-message-inline">{commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject}</pre>}
      </details>
      <GitDiffReview sessionId={sessionId} diff={detail.diff} emptyText="Este commit não contém alterações de ficheiros."/>
      {detail.diff_truncated && <p className="git-hint">O diff foi truncado apenas para apresentação.</p>}
    </div>
  </div>, document.body)
}

function CommitGraph({ row }: { row: GitGraphRow }) {
  const laneWidth = 14
  const padding = 7
  const width = Math.max(row.before.length, row.after.length, 1) * laneWidth + padding * 2
  const x = (lane: number) => padding + lane * laneWidth + laneWidth / 2
  const color = (tone: number) => `var(--git-lane-${tone})`
  return <div className="git-commit-graph" style={{ width }} aria-hidden="true">
    <svg className="git-commit-graph-lines" viewBox={`0 0 ${width} 34`} preserveAspectRatio="none" focusable="false">
      {row.before.map((lane, index) => {
        if (index === row.lane) return null
        const target = row.after.findIndex((next) => next.sha === lane.sha)
        if (target < 0) return null
        return <path key={`carry-${lane.sha}-${index}`} d={`M ${x(index)} 0 C ${x(index)} 10, ${x(target)} 24, ${x(target)} 34`} stroke={color(lane.tone)}/>
      })}
      <path d={`M ${x(row.lane)} 0 L ${x(row.lane)} 17`} stroke={color(row.tone)}/>
      {row.parentLanes.map((parentLane, index) => <path key={`parent-${index}`} d={`M ${x(row.lane)} 17 C ${x(row.lane)} 22, ${x(parentLane)} 25, ${x(parentLane)} 34`} stroke={color(index === 0 ? row.tone : row.after[parentLane]?.tone ?? row.tone)}/>)}
    </svg>
    <span className="git-graph-node" style={{ left: x(row.lane), borderColor: color(row.tone) }}/>
  </div>
}

function formatCommitDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}


function WorktreeDiffModal({ sessionId, file, onClose }: { sessionId: string; file: GitFileDiff; onClose: () => void }) {
  return createPortal(<div className="git-diff-backdrop" onMouseDown={onClose}>
    <div className="git-diff-modal" role="dialog" aria-modal="true" aria-label={`Diff de ${file.path}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="panel-kicker">Alteração no worktree</span><strong>{file.path}</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar diff"><Icon name="close" size={13}/></button></header>
      <GitDiffReview sessionId={sessionId} diff={file.diff} emptyText="Sem diferenças de conteúdo para apresentar."/>
      {file.truncated && <p className="git-hint">O diff foi truncado apenas para apresentação.</p>}
    </div>
  </div>, document.body)
}

function DiffModal({ sessionId, record, onClose }: { sessionId: string; record: GitPendingCommit; onClose: () => void }) {
  return createPortal(<div className="git-diff-backdrop" onMouseDown={onClose}>
    <div className="git-diff-modal" role="dialog" aria-modal="true" aria-label={`Diff de ${record.subject}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="panel-kicker">Registo Wharnex</span><strong>{record.subject}</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar diff"><Icon name="close" size={13}/></button></header>
      <GitDiffReview sessionId={sessionId} diff={record.diff} emptyText="Sem diff registado."/>
      {record.diff_truncated && <p className="git-hint">O diff foi truncado para apresentação; o commit usa sempre o conteúdo atual dos ficheiros.</p>}
      <details className="git-message-preview"><summary>Mensagem de commit</summary><pre>{record.message}</pre></details>
    </div>
  </div>, document.body)
}
