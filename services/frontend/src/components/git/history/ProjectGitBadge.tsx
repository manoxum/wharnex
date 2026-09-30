import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitBranch, GitOverview, Session } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { announceHeaderPopover, subscribeOtherHeaderPopover } from '../../../lib/desktop/bridge/headerPopover'
import { announceGitChanged, subscribeGitLiveSync } from '../../../lib/git/workflow/gitLiveSync'
import { useGitOperationFlow, type GitQuickCommitAction } from '../../../lib/git/workflow/useGitOperationFlow'
import { currentBranch, loadGitProjectOverviews, repositoryLabel, repositoryRemote, repositoryOutgoing, type GitRepositoryOverviewEntry } from '../../../lib/git/workflow/gitProjectOverview'
import { Icon } from '../../presentation/chrome/Icon'
import { GitOperationModal, type GitOperationTarget } from '../review/GitOperationModal'
import { GitRepositorySummary } from './GitRepositorySummary'

export function ProjectGitBadge({ session, sessionID, busy, onSession, onSync }: { session?: Session; sessionID?: string; busy: boolean; onSession?: (session: Session) => void; onSync?: () => void }) {
  const id = session?.id || sessionID || ''
  const [overview, setOverview] = useState<GitOverview>()
  const [entries, setEntries] = useState<GitRepositoryOverviewEntry[]>([])
  const [open, setOpen] = useState(false)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [branch, setBranch] = useState('')
  const [notice, setNotice] = useState('')
  const [, setNoticeError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const autoFetchRunning = useRef(false)

  const refresh = useCallback(async () => {
    if (!id) throw new Error('Sessão Git ainda não disponível.')
    const next = await loadGitProjectOverviews(id)
    setOverview(next.root); setEntries(next.entries); setBranch(next.root.current_branch || '')
    return next.root
  }, [id])

  useEffect(() => {
    let alive = true
    if (!id) { setOverview(undefined); setEntries([]); setBranch(''); return }
    void loadGitProjectOverviews(id).then((next) => {
      if (!alive) return
      setOverview(next.root); setEntries(next.entries); setBranch(next.root.current_branch || '')
    }).catch(() => {})
    return () => { alive = false }
  }, [id, session?.state, session?.last_host_applied_at])

  const repositoryPathsKey = useMemo(() => entries.map((entry) => entry.repository.path).join('\u0000'), [entries])
  useEffect(() => {
    if (!id) return
    const paths = entries.length ? entries.map((entry) => entry.repository.path) : ['']
    const cleanups = paths.map((path) => subscribeGitLiveSync(id, path, () => { void refresh().catch(() => {}) }))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [id, entries, repositoryPathsKey, refresh])

  useEffect(() => subscribeOtherHeaderPopover('git', () => setOpen(false)), [])
  useEffect(() => {
    if (!open) { setBranchPickerOpen(false); return }
    const closePopup = () => { setBranchPickerOpen(false); setOpen(false) }
    const inside = (target: EventTarget | null) => target instanceof Node && rootRef.current?.contains(target) === true
    const onPointerDown = (event: PointerEvent) => { if (!inside(event.target)) closePopup(); else if (branchPickerOpen && event.target instanceof Node && !pickerRef.current?.contains(event.target)) setBranchPickerOpen(false) }
    const onFocusIn = (event: FocusEvent) => { if (!inside(event.target)) closePopup() }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closePopup() }
    document.addEventListener('pointerdown', onPointerDown, true); document.addEventListener('focusin', onFocusIn, true); document.addEventListener('keydown', onKeyDown, true); window.addEventListener('blur', closePopup)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('focusin', onFocusIn, true); document.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('blur', closePopup) }
  }, [open, branchPickerOpen])

  const locals = useMemo(() => (overview?.branches || []).filter((item) => !item.remote), [overview])
  const remotes = useMemo(() => (overview?.branches || []).filter((item) => item.remote), [overview])
  const current = locals.find((item) => item.current)
  const selected = (overview?.branches || []).find((item) => item.name === branch)
  const availableEntries = entries.filter((entry) => entry.repository.available && entry.overview)
  const targets: GitOperationTarget[] = entries.map((entry) => { const active = currentBranch(entry.overview); return { path: entry.repository.path, label: repositoryLabel(entry), branch: entry.overview?.detached ? 'HEAD destacado' : active?.name || entry.repository.current_branch || 'sem branch', detail: active?.has_upstream && !active.gone ? active.upstream : 'branch apenas local', ahead: active?.ahead || 0, behind: active?.behind || 0, available: entry.repository.available && Boolean(entry.overview) } })
  const currentBranchName = overview?.detached ? 'HEAD destacado' : overview?.current_branch || 'sem branch'
  const workingCount = entries.reduce((sum, entry) => sum + (entry.overview?.working.files.length || 0), 0)
  const pendingCommitCount = entries.reduce((sum, entry) => sum + (entry.overview?.pending.length || 0), 0)
  const outgoingCount = entries.reduce((sum, entry) => sum + repositoryOutgoing(entry), 0)
  const gitStateLabel = gitProjectStateLabel(workingCount, pendingCommitCount, outgoingCount)
  const report = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : String(error)); setNoticeError(true)
  }, [])
  const { operation, selectRepositories, previewsForRepositories, closeOperation } = useGitOperationFlow({
    sessionId: id, onSession, onSync, loadOverview: refresh, report, repositoryTargets: targets, availableEntries, setWorking, setNotice, setNoticeError,
  })

  useEffect(() => {
    if (!id) return
    const timer = window.setInterval(() => {
      if (busy || working || operation || autoFetchRunning.current) return
      autoFetchRunning.current = true
      void (async () => {
        try {
          const project = await loadGitProjectOverviews(id)
          for (const entry of project.entries) for (const remote of entry.overview?.remotes || []) await api.gitFetch(id, remote.name, entry.repository.path)
          await refresh(); announceGitChanged(id)
        } catch { /* best-effort periodic fetch */ }
        finally { autoFetchRunning.current = false }
      })()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [id, busy, working, operation, refresh])

  async function runForRepositories(paths: string[], action: (entry: GitRepositoryOverviewEntry) => Promise<string>) {
    const successes: string[] = []; const failures: string[] = []
    for (const path of paths) {
      const entry = availableEntries.find((item) => item.repository.path === path); if (!entry) continue
      try { successes.push(`${repositoryLabel(entry)}: ${await action(entry)}`) } catch (error) { failures.push(`${repositoryLabel(entry)}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    if (failures.length) throw new Error(`${successes.length ? `${successes.length} repositório(s) concluído(s). ` : ''}Falhou em ${failures.join(' | ')}`)
    return successes.length === 1 ? successes[0].replace(/^[^:]+: /, '') : `Operação concluída em ${successes.length} repositórios.`
  }

  function quickCommitFor(paths: string[]): GitQuickCommitAction | undefined {
    const changed = paths.map((path) => availableEntries.find((entry) => entry.repository.path === path)).filter((entry): entry is GitRepositoryOverviewEntry => Boolean(entry)).map((entry) => ({
      entry,
      files: (entry.overview?.working.files || []).filter((file) => file.kind === 'change' || file.kind === 'gitlink'),
    })).filter((item) => item.files.length > 0)
    const fileCount = changed.reduce((sum, item) => sum + item.files.length, 0)
    if (!fileCount) return undefined
    const missingIdentity = changed.filter((item) => !item.entry.overview?.has_identity).map((item) => repositoryLabel(item.entry))
    return {
      fileCount,
      repositoryCount: changed.length,
      unavailableReason: missingIdentity.length ? `Configure user.name e user.email antes do commit rápido em: ${missingIdentity.join(', ')}.` : undefined,
      run: (message) => runForRepositories(changed.map((item) => item.entry.repository.path), async (entry) => {
        const result = await api.commitGitWorktree(id, message, [], entry.repository.path, true)
        return `Commit ${result.commit_sha.slice(0, 8)} criado com ${result.paths.length} ficheiro(s).`
      }),
    }
  }

  async function copyBranch(name: string) { try { await navigator.clipboard.writeText(name); setNotice(`Nome da branch ${name} copiado.`) } catch { setNotice('Não foi possível copiar o nome da branch.') } }
  const disabled = busy || working || !id || !overview?.available
  return <div ref={rootRef} className="project-git-badge-wrap">
    <button type="button" className={`project-git-badge ${workingCount ? 'has-working' : ''} ${pendingCommitCount ? 'has-pending-commit' : ''} ${outgoingCount ? 'has-outgoing' : ''} ${open ? 'active' : ''}`.trim()} onClick={() => { if (!open) announceHeaderPopover('git'); setOpen((value) => !value) }} aria-expanded={open} aria-label={`Git: ${currentBranchName}, projeto ${overview?.project_version || 'sem versão'}`}>
      <span className="project-git-branch"><span className="project-git-icon"><Icon name="git" size={13}/>{gitStateLabel && <span className="project-git-state-dots" aria-label={gitStateLabel}>{workingCount ? <i className="working"/> : null}{pendingCommitCount ? <i className="pending"/> : null}{outgoingCount ? <i className="outgoing"/> : null}</span>}</span><strong>{currentBranchName}</strong></span><span className="project-git-version">{overview?.project_version || 'v…'}</span><Icon name="chevron" size={11}/>
    </button>
    {open && <section className="project-git-menu" aria-label="Operações da branch atual" data-chatgpt-overlay-blocker="true">
      <header className="project-git-menu-header"><div className="project-git-menu-title"><span className="project-git-menu-icon"><Icon name="git" size={14}/></span><div><span>Git do projeto</span><strong>{currentBranchName}</strong></div></div><div className="project-git-menu-meta">{overview?.current_branch && <button type="button" className="project-git-copy-button" aria-label={`Copiar nome da branch ${overview.current_branch}`} onClick={() => void copyBranch(overview.current_branch || '')}><Icon name="copy" size={12}/></button>}<span className="project-git-menu-version">{overview?.project_version || '—'}</span></div></header>
      <GitRepositorySummary entries={entries} compact/>
      {current && <div className={`project-git-sync-card ${current.has_upstream && !current.gone ? 'linked' : 'local'}`}><span className="project-git-sync-state"><i aria-hidden="true"/><span><strong>{current.has_upstream && !current.gone ? 'Ligada ao remoto' : 'Branch apenas local'}</strong><small>{current.has_upstream && !current.gone ? current.upstream : 'Sem upstream configurado'}</small></span></span>{current.has_upstream && !current.gone && <span className="project-git-sync-counts" aria-label={`${current.ahead} para enviar e ${current.behind} para receber`}><b title={`${current.ahead} commit(s) para enviar`}><Icon name="arrow-up" size={10}/>{current.ahead}</b><b title={`${current.behind} commit(s) para receber`}><Icon name="arrow-down" size={10}/>{current.behind}</b></span>}</div>}
      <div ref={pickerRef} className="project-git-picker"><span className="project-git-picker-label">Trocar de branch</span><button type="button" className="project-git-picker-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={branchPickerOpen} onClick={() => setBranchPickerOpen((value) => !value)}><span className="project-git-picker-copy"><strong>{branch || 'Escolher branch…'}</strong><small>{selected ? branchSummary(selected) : 'Local ou remota'}</small></span><Icon name="chevron" size={11}/></button>{branchPickerOpen && <div className="project-git-branch-menu" role="menu" aria-label="Branches disponíveis" data-chatgpt-overlay-blocker="true"><BranchPickerGroup label="Locais" branches={locals} branch={branch} onPick={(name) => { setBranch(name); setBranchPickerOpen(false) }} onCopy={copyBranch}/>{remotes.length > 0 && <BranchPickerGroup label="Remotas" branches={remotes} branch={branch} onPick={(name) => { setBranch(name); setBranchPickerOpen(false) }} onCopy={copyBranch}/>}</div>}</div>
      <div className="project-git-actions">
        <button type="button" disabled={disabled || !branch} onClick={() => selectRepositories('A alternar branch', `Escolha os repositórios onde pretende alternar para ${branch}.`, async (paths) => runForRepositories(paths, async (entry) => { await api.gitSwitch(id, branch, entry.repository.path); return `Branch alterada para ${branch}.` }), true)}><Icon name="bridge" size={12}/> Alternar</button>
        <button type="button" disabled={disabled || !availableEntries.some((entry) => entry.overview!.remotes.length)} onClick={() => selectRepositories('A procurar alterações na origem', 'Escolha os repositórios cujas referências remotas serão atualizadas.', async (paths) => runForRepositories(paths, async (entry) => { const remote = repositoryRemote(entry); if (!remote) throw new Error('Sem remoto configurado.'); await api.gitFetch(id, remote, entry.repository.path); return `Fetch de ${remote} concluído.` }))}><Icon name="refresh" size={12}/> Fetch</button>
        <button type="button" disabled={disabled} onClick={() => selectRepositories('A integrar alterações da origem', 'Escolha os repositórios que devem receber alterações da respetiva branch remota.', async (paths) => runForRepositories(paths, async (entry) => { const active = currentBranch(entry.overview); const remote = repositoryRemote(entry); if (!active || !remote) throw new Error('Sem branch/remoto disponível.'); const result = await api.gitPull(id, remote, active.name, entry.repository.path); return result.detail || `Pull: ${result.outcome}.` }), true)}><Icon name="arrow-down" size={12}/> Pull</button>
        <button type="button" disabled={disabled} className="primary" onClick={() => selectRepositories(
          'A publicar alterações',
          'Escolha os repositórios cujas branches locais serão publicadas.',
          async (paths) => runForRepositories(paths, async (entry) => { const active = currentBranch(entry.overview); const remote = repositoryRemote(entry); if (!active || !remote) throw new Error('Sem branch/remoto disponível.'); const result = await api.gitPush(id, remote, active.name, !active.has_upstream, entry.repository.path); return result.detail || `Push: ${result.outcome}.` }),
          true,
          targets,
          (paths) => previewsForRepositories(paths, async (entry) => { const active = currentBranch(entry.overview); const remote = repositoryRemote(entry); if (!active || !remote) throw new Error('Sem branch/remoto disponível.'); return api.gitPreview(id, { operation: 'push', repository: entry.repository.path, remote, branch: active.name }) }),
          quickCommitFor,
        )}><Icon name="arrow-up" size={12}/> Push</button>
      </div>{notice && <p className="project-git-notice" role="status">{notice}</p>}
    </section>}
    {operation && createPortal(<div className="project-git-operation-layer" data-chatgpt-overlay-blocker="true"><GitOperationModal operation={operation} sessionId={id} onClose={closeOperation}/></div>, document.body)}
  </div>
}

function gitProjectStateLabel(working: number, pending: number, outgoing: number) { const parts: string[] = []; if (working) parts.push(`${working} alteração${working === 1 ? '' : 'ões'} sem commit`); if (pending) parts.push(`${pending} commit${pending === 1 ? '' : 's'} pendente${pending === 1 ? '' : 's'}`); if (outgoing) parts.push(`${outgoing} commit${outgoing === 1 ? '' : 's'} por enviar`); return parts.join(' · ') }
function branchSummary(branch: GitBranch) { return `${branch.remote ? 'Remota' : branch.current ? 'Local · atual' : 'Local'}${branch.ahead > 0 || branch.behind > 0 ? ` · ↑${branch.ahead} ↓${branch.behind}` : ' · em dia'}` }
function BranchPickerGroup({ label, branches, branch, onPick, onCopy }: { label: string; branches: GitBranch[]; branch: string; onPick: (branch: string) => void; onCopy: (branch: string) => Promise<void> }) {
  return <div className="project-git-branch-group"><span className="project-git-branch-group-label">{label}<b>{branches.length}</b></span>{branches.map((item) => <div key={item.name} className={`project-git-branch-option ${item.name === branch ? 'selected' : ''} ${item.current ? 'current' : ''}`}><button type="button" className="project-git-branch-option-main" role="menuitem" onClick={() => onPick(item.name)}><span className="project-git-branch-option-icon"><Icon name="git" size={11}/></span><span className="project-git-branch-option-copy"><strong>{item.name}</strong><small>{item.subject || (item.remote ? 'Referência remota' : 'Branch local')}</small></span><span className="project-git-branch-option-meta">{item.current && <b className="current">Atual</b>}{item.ahead > 0 && <b className="outgoing" title={`${item.ahead} commit(s) para enviar`}><Icon name="arrow-up" size={9}/>{item.ahead}</b>}{item.behind > 0 && <b className="incoming" title={`${item.behind} commit(s) para receber`}><Icon name="arrow-down" size={9}/>{item.behind}</b>}<b className="scope">{item.remote ? 'Remota' : 'Local'}</b></span></button><button type="button" className="project-git-copy-button" aria-label={`Copiar nome da branch ${item.name}`} onClick={() => void onCopy(item.name)}><Icon name="copy" size={11}/></button></div>)}</div>
}
