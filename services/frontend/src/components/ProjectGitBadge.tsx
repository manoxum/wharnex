import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitBranch, GitOverview, Session } from '../types'
import { api } from '../lib/api'
import { announceGitChanged, subscribeGitLiveSync } from '../lib/gitLiveSync'
import { Icon } from './Icon'
import { GitOperationModal, type GitOperation } from './GitOperationModal'

export function ProjectGitBadge({ session, sessionID, busy, onSession, onSync }: { session?: Session; sessionID?: string; busy: boolean; onSession?: (session: Session) => void; onSync?: () => void }) {
  const id = session?.id || sessionID || ''
  const [overview, setOverview] = useState<GitOverview>()
  const [open, setOpen] = useState(false)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [branch, setBranch] = useState('')
  const [notice, setNotice] = useState('')
  const [operation, setOperation] = useState<GitOperation | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const autoFetchRunning = useRef(false)

  const refresh = useCallback(async () => {
    if (!id) throw new Error('Sessão Git ainda não disponível.')
    const next = await api.gitOverview(id)
    setOverview(next)
    setBranch(next.current_branch || '')
    return next
  }, [id])

  useEffect(() => {
    let alive = true
    if (!id) { setOverview(undefined); setBranch(''); return }
    void api.gitOverview(id).then((next) => {
      if (!alive) return
      setOverview(next)
      setBranch(next.current_branch || '')
    }).catch(() => {})
    return () => { alive = false }
  }, [id, session?.state, session?.last_host_applied_at])

  useEffect(() => {
    if (!id) return
    return subscribeGitLiveSync(id, () => { void refresh().catch(() => {}) })
  }, [id, refresh])

  useEffect(() => {
    if (!id) return
    let alive = true
    const timer = window.setInterval(() => {
      if (busy || working || autoFetchRunning.current) return
      autoFetchRunning.current = true
      void (async () => {
        try {
          const snapshot = await api.gitOverview(id)
          if (!snapshot.available || snapshot.remotes.length === 0) return
          for (const remote of snapshot.remotes) await api.gitFetch(id, remote.name)
          const updated = await api.gitOverview(id)
          if (alive) {
            setOverview(updated)
            setBranch(updated.current_branch || '')
            announceGitChanged(id)
          }
        } catch {
          // Periodic remote refresh is best-effort; explicit actions report failures.
        } finally {
          autoFetchRunning.current = false
        }
      })()
    }, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [id, busy, working])

  useEffect(() => {
    if (!open) { setBranchPickerOpen(false); return }

    const closePopup = () => {
      setBranchPickerOpen(false)
      setOpen(false)
    }
    const isInsidePopup = (target: EventTarget | null) => target instanceof Node && rootRef.current?.contains(target) === true
    const onPointerDown = (event: PointerEvent) => {
      if (!isInsidePopup(event.target)) {
        closePopup()
        return
      }
      if (branchPickerOpen && event.target instanceof Node && !pickerRef.current?.contains(event.target)) setBranchPickerOpen(false)
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!isInsidePopup(event.target)) closePopup()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopup()
    }
    const onWindowBlur = () => closePopup()

    // Capture phase keeps dismissal reliable even when another workbench control
    // stops propagation before the event reaches document in the bubble phase.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, branchPickerOpen])

  const locals = useMemo(() => (overview?.branches || []).filter((item) => !item.remote), [overview])
  const remotes = useMemo(() => (overview?.branches || []).filter((item) => item.remote), [overview])
  const current = locals.find((item) => item.current)
  const selected = (overview?.branches || []).find((item) => item.name === branch)
  const remote = current?.upstream?.split('/')[0] || overview?.remotes[0]?.name || ''
  const currentBranch = overview?.detached ? 'HEAD destacado' : overview?.current_branch || 'sem branch'

  async function copyBranch(name: string) {
    try {
      await navigator.clipboard.writeText(name)
      setNotice(`Nome da branch ${name} copiado.`)
    } catch {
      setNotice('Não foi possível copiar o nome da branch.')
    }
  }

  async function run(action: () => Promise<string>, syncSession = false) {
    setWorking(true); setNotice('')
    try {
      const message = await action()
      await refresh()
      announceGitChanged(id)
      if (syncSession && onSession) onSession(await api.getSession(id))
      if (syncSession) onSync?.()
      setNotice(message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally { setWorking(false) }
  }

  async function runGitOperation(title: string, detail: string, action: () => Promise<string>, syncSession = false) {
    let phase: 'running' | 'refreshing' = 'running'
    let actionMessage = ''
    setWorking(true); setNotice('')
    setOperation({ title, detail, phase })
    try {
      actionMessage = await action()
      phase = 'refreshing'
      setOperation({ title, detail, phase })
      await refresh()
      announceGitChanged(id)
      if (syncSession && onSession) onSession(await api.getSession(id))
      if (syncSession) onSync?.()
      setNotice(actionMessage)
      setOperation({ title, detail, phase: 'success', message: actionMessage })
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      const message = phase === 'refreshing' && actionMessage ? `${actionMessage} Não foi possível atualizar o painel: ${cause}` : cause
      setNotice(message)
      setOperation({ title, detail, phase: 'error', message, failedPhase: phase })
    } finally { setWorking(false) }
  }

  const disabled = busy || working || !id || !overview?.available
  return <div ref={rootRef} className="project-git-badge-wrap">
    <button type="button" className={`project-git-badge ${open ? 'active' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`Git: ${currentBranch}, projeto ${overview?.project_version || 'sem versão'}`}>
      <span className="project-git-branch"><Icon name="git" size={13}/><strong>{currentBranch}</strong></span>
      <span className="project-git-version">{overview?.project_version || 'v…'}</span>
      <Icon name="chevron" size={11}/>
    </button>
    {open && <section className="project-git-menu" aria-label="Operações da branch atual">
      <header className="project-git-menu-header">
        <span className="project-git-menu-icon"><Icon name="git" size={15}/></span>
        <div><span>Branch de trabalho</span><strong>{currentBranch}</strong></div>
        {overview?.current_branch && <button type="button" className="project-git-copy-button" aria-label={`Copiar nome da branch ${overview.current_branch}`} title="Copiar nome da branch" onClick={() => void copyBranch(overview.current_branch || '')}><Icon name="copy" size={12}/></button>}
        <span className="project-git-menu-version">{overview?.project_version || '—'}</span>
      </header>

      <div ref={pickerRef} className="project-git-picker">
        <span className="project-git-picker-label">Alternar branch</span>
        <button type="button" className="project-git-picker-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={branchPickerOpen} onClick={() => setBranchPickerOpen((value) => !value)}>
          <span className="project-git-picker-copy"><strong>{branch || 'Escolher branch…'}</strong><small>{selected ? branchSummary(selected) : 'Local ou remota'}</small></span>
          <Icon name="chevron" size={11}/>
        </button>
        {branchPickerOpen && <div className="project-git-branch-menu" role="menu" aria-label="Branches disponíveis">
          <BranchPickerGroup label="Locais" branches={locals} branch={branch} onPick={(name) => { setBranch(name); setBranchPickerOpen(false) }} onCopy={copyBranch}/>
          {remotes.length > 0 && <BranchPickerGroup label="Remotas" branches={remotes} branch={branch} onPick={(name) => { setBranch(name); setBranchPickerOpen(false) }} onCopy={copyBranch}/>}
        </div>}
      </div>

      <div className="project-git-actions">
        <button type="button" disabled={disabled || !branch || branch === overview?.current_branch} onClick={() => void run(async () => { await api.gitSwitch(id, branch); return `Branch alterada para ${branch}.` }, true)}><Icon name="bridge" size={12}/> Alternar</button>
        <button type="button" disabled={disabled || !remote} onClick={() => void runGitOperation(
          'A procurar alterações na origem',
          `A atualizar as referências remotas a partir de ${remote}.`,
          async () => { await api.gitFetch(id, remote); return `Fetch de ${remote} concluído.` },
        )}><Icon name="refresh" size={12}/> Fetch</button>
        <button type="button" disabled={disabled || !remote || !overview?.current_branch} onClick={() => void runGitOperation(
          'A integrar alterações da origem',
          `A trazer ${remote}/${overview?.current_branch || ''} para a branch local.`,
          async () => { const result = await api.gitPull(id, remote, overview?.current_branch || ''); return result.conflict_id ? 'Pull encontrou conflito. Escolha resolução manual ou GPT no chat.' : `Pull: ${result.outcome}.` },
          true,
        )}><Icon name="arrow-down" size={12}/> Pull</button>
        <button type="button" disabled={disabled || !remote || !overview?.current_branch} onClick={() => void runGitOperation(
          'A publicar alterações',
          `A enviar ${overview?.current_branch || ''} para ${remote}${!current?.has_upstream ? ' e a configurar o upstream' : ''}.`,
          async () => { const result = await api.gitPush(id, remote, overview?.current_branch || '', !current?.has_upstream); return result.conflict_id ? 'Push encontrou conflito. Escolha resolução manual ou GPT no chat.' : `Push: ${result.outcome}.` },
          true,
        )}><Icon name="arrow-up" size={12}/> Push</button>
      </div>
      {current && <p className="project-git-sync">{current.has_upstream ? `${current.upstream} · ↑${current.ahead} ↓${current.behind}` : 'Sem upstream configurado'}</p>}
      {notice && <p className="project-git-notice" role="status">{notice}</p>}
    </section>}
    {operation && createPortal(
      <div className="project-git-operation-layer"><GitOperationModal operation={operation} onClose={() => setOperation(null)}/></div>,
      document.body,
    )}
  </div>
}

function branchSummary(branch: GitBranch) {
  const location = branch.remote ? 'Remota' : branch.current ? 'Local · atual' : 'Local'
  const sync = branch.ahead > 0 || branch.behind > 0 ? ` · ↑${branch.ahead} ↓${branch.behind}` : ' · em dia'
  return `${location}${sync}`
}

function BranchPickerGroup({ label, branches, branch, onPick, onCopy }: { label: string; branches: GitBranch[]; branch: string; onPick: (branch: string) => void; onCopy: (branch: string) => Promise<void> }) {
  return <div className="project-git-branch-group">
    <span className="project-git-branch-group-label">{label}<b>{branches.length}</b></span>
    {branches.map((item) => <div key={item.name} className={`project-git-branch-option ${item.name === branch ? 'selected' : ''} ${item.current ? 'current' : ''}`}>
      <button type="button" className="project-git-branch-option-main" role="menuitem" onClick={() => onPick(item.name)}>
        <span className="project-git-branch-option-icon"><Icon name="git" size={11}/></span>
        <span className="project-git-branch-option-copy"><strong>{item.name}</strong><small>{item.subject || (item.remote ? 'Referência remota' : 'Branch local')}</small></span>
        <span className="project-git-branch-option-meta">
          {item.current && <b className="current">Atual</b>}
          {item.ahead > 0 && <b className="outgoing" title={`${item.ahead} commit(s) para enviar`}><Icon name="arrow-up" size={9}/>{item.ahead}</b>}
          {item.behind > 0 && <b className="incoming" title={`${item.behind} commit(s) para receber`}><Icon name="arrow-down" size={9}/>{item.behind}</b>}
          {item.ahead === 0 && item.behind === 0 && <b className="clean"><Icon name="check" size={9}/>Em dia</b>}
          <b className="scope">{item.remote ? 'Remota' : 'Local'}</b>
        </span>
      </button>
      <button type="button" className="project-git-copy-button" aria-label={`Copiar nome da branch ${item.name}`} title="Copiar nome da branch" onClick={() => void onCopy(item.name)}><Icon name="copy" size={11}/></button>
    </div>)}
  </div>
}
