import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConflictManualResolution, ConflictWorkbench, GitConflictStrategy, Session } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { CodeEditor } from '../canvas/CodeEditor'
import { Icon } from '../../presentation/chrome/Icon'
import { StatusPill } from '../../presentation/chrome/StatusPill'
import { InternalWindow } from '../../workspace/window/InternalWindow'

type Draft = { content: string; exists: boolean; resolved: boolean }

export function ConflictResolverModal({ session, busy, strategy = 'user_decide', initialWorkbench, onClose, onSession, onDelegateToGPT }: {
  session: Session
  busy: boolean
  strategy?: GitConflictStrategy
  initialWorkbench?: ConflictWorkbench
  onClose: () => void
  onSession: (session: Session) => void
  onDelegateToGPT: (session: Session) => Promise<void>
}) {
  const [workbench, setWorkbench] = useState<ConflictWorkbench | undefined>(initialWorkbench)
  const [activePath, setActivePath] = useState(initialWorkbench?.files[0]?.path || '')
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => makeDrafts(initialWorkbench))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [guidance, setGuidance] = useState('')
  const readOnly = strategy === 'gpt_only'
  const canDelegate = strategy === 'user_decide'

  useEffect(() => {
    if (initialWorkbench) {
      setWorkbench(initialWorkbench)
      setActivePath(initialWorkbench.files[0]?.path || '')
      setDrafts(makeDrafts(initialWorkbench))
      return
    }
    let alive = true
    api.conflictWorkbench(session.id).then((next) => {
      if (!alive) return
      setWorkbench(next); setActivePath(next.files[0]?.path || ''); setDrafts(makeDrafts(next))
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { alive = false }
  }, [session.id, session.integration_conflict?.id, initialWorkbench])

  const file = workbench?.files.find((candidate) => candidate.path === activePath)
  const draft = activePath ? drafts[activePath] : undefined
  const resolvedCount = Object.values(drafts).filter((item) => item.resolved).length
  const allResolved = Boolean(workbench?.files.length) && resolvedCount === workbench?.files.length
  const locked = busy || submitting || readOnly
  const resolvedPayload = useMemo<ConflictManualResolution[]>(() => Object.entries(drafts)
    .filter(([, item]) => item.resolved)
    .map(([path, item]) => ({ path, content: item.content, exists: item.exists })), [drafts])

  function updateDraft(patch: Partial<Draft>) { if (activePath && draft) setDrafts((current) => ({ ...current, [activePath]: { ...current[activePath], ...patch } })) }
  function accept(content: string, exists: boolean) { updateDraft({ content, exists, resolved: true }) }

  async function applyManual() {
    if (!allResolved || readOnly) return
    setSubmitting(true); setError('')
    try { const result = await api.resolveConflictManually(session.id, resolvedPayload); onSession(result.session); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSubmitting(false) }
  }

  async function delegateRemaining() {
    if (!canDelegate) return
    setSubmitting(true); setError('')
    try { const updated = await api.delegateConflictToGPT(session.id, resolvedPayload, guidance); onSession(updated); onClose(); await onDelegateToGPT(updated) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSubmitting(false) }
  }

  return <InternalWindow title="Resolver conflito Git" layerClassName="diff-inspector-backdrop" onClose={onClose} closeDisabled={busy || submitting}>
    <section className="flex h-[min(86vh,900px)] w-[min(96vw,1500px)] min-w-0 flex-col overflow-hidden rounded-xl border border-whx-border bg-whx-surface" role="dialog" aria-modal="false" aria-label="Resolução manual de conflito">
      <header className="flex items-center justify-between gap-3 border-b border-whx-border px-4 py-3"><div className="min-w-0"><span className="panel-kicker">Merge de três vias</span><strong className="block">Resolver conflito</strong><span className="text-xs text-whx-faint">Atual · Resultado · Recebido</span></div><div className="flex items-center gap-2"><StatusPill tone={allResolved ? 'success' : 'warning'}>{readOnly ? 'GPT Only · informativo' : `${resolvedCount}/${workbench?.files.length || 0} resolvido(s)`}</StatusPill><button className="icon-button light" disabled={busy || submitting} onClick={onClose} aria-label="Fechar resolução"><Icon name="close" size={14}/></button></div></header>
      {error && <div className="m-3 rounded-lg border border-whx-danger/40 bg-whx-danger/10 px-3 py-2 text-xs text-whx-danger">{error}</div>}
      {!workbench ? <div className="flex flex-1 items-center justify-center text-sm text-whx-muted">A carregar versões do conflito…</div> : <>
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-whx-border px-3 py-2" role="tablist" aria-label="Ficheiros em conflito">{workbench.files.map((candidate) => <button key={candidate.path} role="tab" aria-selected={candidate.path === activePath} className={`max-w-[320px] truncate rounded-md px-3 py-1.5 text-xs ${candidate.path === activePath ? 'bg-whx-elevated text-whx-text' : 'text-whx-muted hover:bg-whx-hover'}`} onClick={() => setActivePath(candidate.path)}><span className="mr-1.5">{drafts[candidate.path]?.resolved ? '✓' : '•'}</span>{candidate.path}</button>)}</nav>
        {file && draft && <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-whx-border lg:grid-cols-3">
          <ConflictPane title="Atual" subtitle={file.current_exists ? 'Versão na branch atual' : 'Ficheiro ausente'} actionLabel={readOnly ? undefined : 'Aceitar atual'} onAccept={() => accept(file.current, file.current_exists)}><CodeEditor path={`.wharnex-conflict/current/${file.path}`} value={file.current} onChange={() => undefined} onSave={() => undefined} onCursorChange={() => undefined} readOnly/></ConflictPane>
          <ConflictPane title="Resultado" subtitle={readOnly ? 'Pré-visualização informativa; o GPT resolverá o conflito' : draft.exists ? (draft.resolved ? 'Marcado como resolvido' : 'Edite a consolidação') : 'Ficheiro será removido'} center>
            <CodeEditor path={`.wharnex-conflict/result/${file.path}`} value={draft.content} onChange={readOnly ? () => undefined : (content) => updateDraft({ content, exists: true, resolved: false })} onSave={readOnly ? () => undefined : () => updateDraft({ resolved: true })} onCursorChange={() => undefined} readOnly={readOnly}/>
            {!readOnly && <div className="flex flex-wrap gap-2 border-t border-whx-border p-2"><button className="secondary-button" onClick={() => updateDraft({ resolved: true })}>Marcar edição como resolvida</button>{(!file.current_exists || !file.incoming_exists) && <button className="text-button danger" onClick={() => updateDraft({ content: '', exists: false, resolved: true })}>Resolver como removido</button>}</div>}
          </ConflictPane>
          <ConflictPane title="Recebido" subtitle={file.incoming_exists ? 'Versão da outra branch' : 'Ficheiro ausente'} actionLabel={readOnly ? undefined : 'Aceitar recebido'} onAccept={() => accept(file.incoming, file.incoming_exists)}><CodeEditor path={`.wharnex-conflict/incoming/${file.path}`} value={file.incoming} onChange={() => undefined} onSave={() => undefined} onCursorChange={() => undefined} readOnly/></ConflictPane>
        </div>}
        {file && <details className="shrink-0 border-t border-whx-border px-4 py-2 text-xs text-whx-muted"><summary className="cursor-pointer font-semibold text-whx-soft">Ver base comum</summary><pre className="mt-2 max-h-36 overflow-auto rounded-md bg-whx-muted p-2 text-[11px]">{file.base_exists ? file.base : 'Ficheiro inexistente na base.'}</pre></details>}
      </>}
      <footer className="flex shrink-0 flex-col gap-2 border-t border-whx-border px-4 py-3 md:flex-row md:items-end md:justify-between">{readOnly ? <p className="m-0 text-xs text-whx-muted">Este modo é apenas informativo. A resolução permanece a cargo do GPT e nenhuma edição manual é aceite aqui.</p> : <div className="min-w-0 flex-1"><span className="block text-xs text-whx-muted">{strategy === 'user_only' ? 'A estratégia User Only exige resolução manual.' : 'Pode resolver tudo manualmente ou delegar apenas o que restar.'}</span>{canDelegate && <textarea className="mt-1 w-full max-w-2xl rounded-md border border-whx-border bg-whx-muted px-2 py-1.5 text-xs text-whx-text" value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Instrução auxiliar opcional para o GPT…" rows={2}/>}</div>}<div className="flex justify-end gap-2"><button className="text-button" disabled={busy || submitting} onClick={onClose}>{readOnly ? 'Fechar' : 'Cancelar'}</button>{canDelegate && <button className="secondary-button" disabled={locked || !workbench || allResolved} onClick={() => void delegateRemaining()}><Icon name="chatgpt" size={14}/> Delegar restantes ao GPT</button>}{!readOnly && <button className="apply-button" disabled={locked || !allResolved} onClick={() => void applyManual()}><Icon name="apply" size={14}/> Aplicar resolução manual</button>}</div></footer>
    </section>
  </InternalWindow>
}

function makeDrafts(workbench?: ConflictWorkbench) { return Object.fromEntries((workbench?.files || []).map((file) => [file.path, { content: file.current, exists: file.current_exists, resolved: false }])) }
function ConflictPane({ title, subtitle, actionLabel, onAccept, center = false, children }: { title: string; subtitle: string; actionLabel?: string; onAccept?: () => void; center?: boolean; children: ReactNode }) { return <section className={`flex min-h-[320px] min-w-0 flex-col bg-whx-surface ${center ? 'ring-1 ring-inset ring-whx-accent/20' : ''}`}><header className="flex items-center justify-between gap-2 border-b border-whx-border px-3 py-2"><div className="min-w-0"><strong className="block text-xs">{title}</strong><span className="block truncate text-[11px] text-whx-faint">{subtitle}</span></div>{actionLabel && <button className="secondary-button" onClick={onAccept}>{actionLabel}</button>}</header><div className="min-h-[260px] flex-1">{children}</div></section> }
