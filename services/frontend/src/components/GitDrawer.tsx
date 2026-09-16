import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitBranch, GitCommitMode, GitOverview, GitPendingCommit, Session } from '../types'
import { api, APIError } from '../lib/api'
import { buildGitGraphRows, type GitGraphRow } from '../lib/gitGraph'
import { Icon } from './Icon'

type GitTab = 'changes' | 'history' | 'branches' | 'settings'

export function GitDrawer({ session, busy, onClose, onError }: {
  session: Session
  busy: boolean
  onClose: () => void
  onError?: (message: string) => void
}) {
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [openDiff, setOpenDiff] = useState<GitPendingCommit | null>(null)
  const [mergeRef, setMergeRef] = useState('')
  const [activeTab, setActiveTab] = useState<GitTab>('changes')

  const report = useCallback((error: unknown) => {
    const message = error instanceof APIError ? error.message : error instanceof Error ? error.message : String(error)
    setNotice(message)
    onError?.(message)
  }, [onError])

  const refresh = useCallback(async () => {
    try {
      setOverview(await api.gitOverview(session.id))
    } catch (error) {
      report(error)
    } finally {
      setLoading(false)
    }
  }, [session.id, report])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void refresh() }, [session.last_host_applied_at, session.state, refresh])

  const localBranches = useMemo(() => (overview?.branches || []).filter((branch) => !branch.remote), [overview])
  const remoteBranches = useMemo(() => (overview?.branches || []).filter((branch) => branch.remote), [overview])
  const current = useMemo(() => localBranches.find((branch) => branch.current), [localBranches])
  const pending = overview?.pending || []

  async function run(action: () => Promise<void>) {
    setWorking(true)
    setNotice('')
    try {
      await action()
      await refresh()
    } catch (error) {
      report(error)
    } finally {
      setWorking(false)
    }
  }

  const disabled = busy || working || loading

  function toggle(id: string) {
    setSelected((currentSelection) => {
      const next = new Set(currentSelection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function commit(ids: string[]) {
    await run(async () => {
      const result = await api.commitGitPending(session.id, ids)
      setSelected(new Set())
      const made = result.outcomes.filter((outcome) => outcome.commit_sha).length
      const skipped = result.outcomes.filter((outcome) => outcome.skipped).length
      setNotice(`${made} commit(s) criado(s)${skipped ? `, ${skipped} registo(s) obsoleto(s) retirado(s)` : ''}.`)
    })
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
      {notice && <p className="git-notice" role="status">{notice}</p>}
      {overview.conflict && <div className="git-conflict-card warning-card">
        <strong>Conflito de Git em resolução</strong>
        <p>A integrar <code>{overview.conflict.ref}</code>. A resolução está no chat e o merge será concluído localmente quando chegar.</p>
      </div>}
      {overview.in_progress && <p className="git-notice warning-card">Há um <strong>{overview.in_progress}</strong> em curso no host. Termine-o ou aborte-o antes de aplicar ou fazer merge.</p>}

      <div className="git-tab-content" role="tabpanel" aria-label={gitTabLabel(activeTab)}>
        {activeTab === 'changes' && <>
          <WorktreeSummary overview={overview}/>
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
        {activeTab === 'history' && <HistorySection commits={overview.commits} branches={overview.branches}/>}
        {activeTab === 'branches' && <BranchSection
          current={current?.name || overview.current_branch} detached={overview.detached}
          localBranches={localBranches} remoteBranches={remoteBranches} remotes={overview.remotes}
          disabled={disabled} mergeRef={mergeRef} onMergeRefChange={setMergeRef}
          onMerge={() => run(async () => {
            const result = await api.gitMerge(session.id, mergeRef)
            setMergeRef('')
            setNotice(result.conflict_id ? `Merge de ${result.ref} entrou em conflito; foi pedida uma resolução ao ChatGPT.` : `Merge de ${result.ref}: ${result.outcome}.`)
          })}
          onPush={(remote, branch, setUpstream) => run(async () => {
            const result = await api.gitPush(session.id, remote, branch, setUpstream)
            setNotice(pushMessage(result.outcome, result.integrated, result.conflict_id))
          })}
        />}
        {activeTab === 'settings' && <RepositorySettings overview={overview} disabled={disabled} onChange={(mode) => run(async () => {
          await api.setGitCommitMode(session.id, mode)
        })}/>}
      </div>
    </>}

    {openDiff && <DiffModal record={openDiff} onClose={() => setOpenDiff(null)} />}
  </section>
}

function gitTabLabel(tab: GitTab) {
  return ({ changes: 'Alterações', history: 'Histórico', branches: 'Branches', settings: 'Definições' } as const)[tab]
}

function GitTabs({ active, onChange, overview }: { active: GitTab; onChange: (tab: GitTab) => void; overview: GitOverview }) {
  const changes = Math.max(overview.pending.length, overview.working.stageable_count)
  const tabs: Array<{ id: GitTab; icon: 'edit' | 'git' | 'bridge' | 'settings'; count?: number }> = [
    { id: 'changes', icon: 'edit', count: changes },
    { id: 'history', icon: 'git', count: overview.commits.length },
    { id: 'branches', icon: 'bridge', count: overview.branches.length },
    { id: 'settings', icon: 'settings' },
  ]
  return <nav className="git-tabs" role="tablist" aria-label="Secções do Git">
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} onClick={() => onChange(tab.id)}>
      <Icon name={tab.icon} size={13}/><span>{gitTabLabel(tab.id)}</span>{typeof tab.count === 'number' && <span className="git-tab-count">{tab.count}</span>}
    </button>)}
  </nav>
}

function WorktreeSummary({ overview }: { overview: GitOverview }) {
  const clean = overview.working.clean
  return <section className="git-worktree-card">
    <span className={`git-worktree-status ${clean ? 'clean' : 'dirty'}`}><Icon name={clean ? 'check' : 'edit'} size={14}/></span>
    <div><strong>{clean ? 'Worktree limpo' : `${overview.working.stageable_count} alteração(ões) no worktree`}</strong>
      <p>{clean ? 'Não há ficheiros locais por commitar.' : 'As alterações locais permanecem separadas dos registos pendentes do Wharnex.'}</p></div>
    <span className="git-worktree-badge">{overview.pending.length} pendente(s)</span>
  </section>
}

function pushMessage(outcome: string, integrated?: boolean, conflictID?: string) {
  if (conflictID) return 'O remoto tinha trabalho que entrou em conflito; foi pedida uma resolução ao ChatGPT. Nada foi publicado.'
  switch (outcome) {
    case 'pushed': return integrated ? 'Trabalho do remoto integrado e push concluído.' : 'Push concluído.'
    case 'up_to_date': return 'O remoto já estava atualizado.'
    case 'auth_required': return 'O remoto pediu credenciais. Configure um credential helper do Git e repita.'
    case 'rejected': return 'O remoto rejeitou o push e a integração automática não foi possível.'
    default: return `Push: ${outcome}.`
  }
}

function RepositorySettings({ overview, disabled, onChange }: { overview: GitOverview; disabled: boolean; onChange: (mode: GitCommitMode) => void }) {
  return <div className="git-settings-stack">
    <CommitModeSection overview={overview} disabled={disabled} onChange={onChange}/>
    <section className="git-section git-remotes-section">
      <div className="git-section-heading"><div><span>Remotos</span><strong>Destinos configurados</strong></div><span className="git-section-count">{overview.remotes.length}</span></div>
      {overview.remotes.length === 0 ? <p className="git-empty inline">Nenhum remoto configurado.</p> : <ul className="git-remote-list">
        {overview.remotes.map((remote) => <li key={remote.name}><Icon name="network" size={13}/><strong>{remote.name}</strong><span>{remote.url}</span></li>)}
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

function BranchSection({ current, detached, localBranches, remoteBranches, remotes, disabled, mergeRef, onMergeRefChange, onMerge, onPush }: {
  current?: string; detached: boolean; localBranches: GitOverview['branches']; remoteBranches: GitOverview['branches']; remotes: GitOverview['remotes']
  disabled: boolean; mergeRef: string; onMergeRefChange: (value: string) => void; onMerge: () => void; onPush: (remote: string, branch: string, setUpstream: boolean) => void
}) {
  const active = localBranches.find((branch) => branch.current)
  const defaultRemote = remotes[0]?.name || 'origin'
  const canPush = Boolean(current) && !detached && remotes.length > 0
  return <section className="git-section git-branches-section">
    <div className="git-branch-hero">
      <span className="git-branch-icon"><Icon name="git" size={16}/></span>
      <div><span>Branch atual</span><strong>{detached ? 'HEAD destacado' : current || '—'}</strong>{active?.has_upstream && <small>↑{active.ahead} ↓{active.behind} · {active.upstream}</small>}{active && !active.has_upstream && <small>sem upstream</small>}</div>
      {canPush && active && <button type="button" className="git-action" disabled={disabled} onClick={() => onPush(defaultRemote, active.name, !active.has_upstream)}><Icon name="arrow-up" size={13}/> Push</button>}
    </div>
    <div className="git-merge-card">
      <div><span>Integrar branch</span><strong>Merge no branch atual</strong></div>
      <div className="git-row">
        <label className="sr-only" htmlFor="git-merge-ref">Branch a fazer merge</label>
        <select id="git-merge-ref" value={mergeRef} disabled={disabled} onChange={(event) => onMergeRefChange(event.target.value)}>
          <option value="">Fazer merge de…</option>
          {[...localBranches.filter((branch) => !branch.current), ...remoteBranches].map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
        </select>
        <button type="button" className="git-action" disabled={disabled || !mergeRef} onClick={onMerge}><Icon name="bridge" size={13}/> Merge</button>
      </div>
    </div>
    <BranchList title="Locais" branches={localBranches}/>
    <BranchList title="Remotas" branches={remoteBranches}/>
  </section>
}

function BranchList({ title, branches }: { title: string; branches: GitBranch[] }) {
  return <div className="git-branch-group"><div className="git-section-heading compact"><div><span>{title}</span></div><span className="git-section-count">{branches.length}</span></div>
    <ul className="git-branch-list">{branches.map((branch) => <li key={branch.name} className={`${branch.current ? 'current' : ''} ${branch.remote ? 'remote' : ''}`}>
      <span className="git-branch-marker"><Icon name="git" size={12}/></span><span className="git-branch-name">{branch.name}</span><span className="git-branch-subject">{branch.subject}</span>
    </li>)}</ul>
  </div>
}

function PendingSection({ pending, selected, disabled, hasIdentity, commitMode, onToggle, onCommitAll, onCommitSelected, onDiscard, onOpenDiff }: {
  pending: GitPendingCommit[]; selected: Set<string>; disabled: boolean; hasIdentity: boolean; commitMode: GitCommitMode
  onToggle: (id: string) => void; onCommitAll: () => void; onCommitSelected: () => void; onDiscard: (id: string) => void; onOpenDiff: (record: GitPendingCommit) => void
}) {
  return <section className="git-section">
    <div className="git-section-heading"><div><span>Fila local</span><strong>Commits pendentes</strong></div><span className="git-section-count">{pending.length}</span></div>
    {pending.length === 0 && <p className="git-empty inline">{commitMode === 'manual' ? 'Nada por commitar. As alterações aplicadas aparecem aqui com a mensagem do planner.' : 'O projeto usa auto-commit, por isso não acumula registos pendentes.'}</p>}
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

function HistorySection({ commits, branches }: { commits: GitOverview['commits']; branches: GitOverview['branches'] }) {
  const rows = buildGitGraphRows(commits)
  const refsBySHA = new Map<string, GitBranch[]>()
  for (const branch of branches) refsBySHA.set(branch.commit_sha, [...(refsBySHA.get(branch.commit_sha) || []), branch])
  return <section className="git-section git-history-section">
    <div className="git-section-heading"><div><span>Timeline</span><strong>Histórico de commits</strong></div><span className="git-section-count">{commits.length}</span></div>
    {commits.length === 0 && <p className="git-empty inline">Sem commits.</p>}
    <ul className="git-commit-list">{rows.map((row) => <li key={row.commit.sha} className="git-history-row">
      <CommitGraph row={row}/>
      <div className="git-history-copy">
        <div className="git-history-subject-line"><span className="git-commit-subject">{row.commit.subject}</span>{(refsBySHA.get(row.commit.sha) || []).slice(0, 3).map((branch) => <span key={branch.name} className={`git-ref-badge ${branch.current ? 'current' : ''}`}>{branch.current && <Icon name="git" size={10}/>} {branch.name}</span>)}</div>
        <div className="git-history-details"><span>{row.commit.author_name}</span><time dateTime={row.commit.committed_at}>{formatCommitDate(row.commit.committed_at)}</time></div>
      </div>
      <span className="git-commit-meta"><code>{row.commit.short_sha}</code>{row.commit.wharnex && <span className="git-commit-tag" title="Originado por uma alteração do Wharnex">WHX</span>}{row.commit.merge && <span className="git-commit-tag">merge</span>}{!row.commit.pushed && <span className="git-commit-tag local">local</span>}</span>
    </li>)}</ul>
  </section>
}

function CommitGraph({ row }: { row: GitGraphRow }) {
  const laneWidth = 14
  const padding = 7
  const width = Math.max(row.before.length, row.after.length, 1) * laneWidth + padding * 2
  const x = (lane: number) => padding + lane * laneWidth + laneWidth / 2
  const color = (tone: number) => `var(--git-lane-${tone})`
  return <svg className="git-commit-graph" viewBox={`0 0 ${width} 34`} style={{ width }} aria-hidden="true">
    {row.before.map((lane, index) => {
      if (index === row.lane) return null
      const target = row.after.findIndex((next) => next.sha === lane.sha)
      if (target < 0) return null
      return <path key={`carry-${lane.sha}-${index}`} d={`M ${x(index)} 0 C ${x(index)} 10, ${x(target)} 24, ${x(target)} 34`} stroke={color(lane.tone)}/>
    })}
    <path d={`M ${x(row.lane)} 0 L ${x(row.lane)} 17`} stroke={color(row.tone)}/>
    {row.parentLanes.map((parentLane, index) => <path key={`parent-${index}`} d={`M ${x(row.lane)} 17 C ${x(row.lane)} 22, ${x(parentLane)} 25, ${x(parentLane)} 34`} stroke={color(index === 0 ? row.tone : row.after[parentLane]?.tone ?? row.tone)}/>)}
    <circle cx={x(row.lane)} cy="17" r="4.1" fill="var(--theme-bg)" stroke={color(row.tone)} className="git-graph-node"/>
  </svg>
}

function formatCommitDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function DiffModal({ record, onClose }: { record: GitPendingCommit; onClose: () => void }) {
  return <div className="git-diff-modal" role="dialog" aria-label={`Diff de ${record.subject}`}>
    <header><strong>{record.subject}</strong><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar diff"><Icon name="close" size={13}/></button></header>
    <pre className="git-diff-body">{record.diff || 'Sem diff registado.'}</pre>
    {record.diff_truncated && <p className="git-hint">O diff foi truncado para apresentação; o commit usa sempre o conteúdo atual dos ficheiros.</p>}
    <details className="git-message-preview"><summary>Mensagem de commit</summary><pre>{record.message}</pre></details>
  </div>
}
