import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConflictManualResolution, ConflictWorkbench, Session } from '../types'
import { api } from '../lib/api'
import { CodeEditor } from './CodeEditor'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { InternalWindow } from './InternalWindow'

type Draft = { content: string; exists: boolean; resolved: boolean }

export function ConflictResolverModal({ session, busy, onClose, onSession, onDelegateToGPT }: {
  session: Session
  busy: boolean
  onClose: () => void
  onSession: (session: Session) => void
  onDelegateToGPT: (session: Session) => Promise<void>
}) {
  const [workbench, setWorkbench] = useState<ConflictWorkbench>()
  const [activePath, setActivePath] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [guidance, setGuidance] = useState('')

  useEffect(() => {
    let alive = true
    api.conflictWorkbench(session.id).then((next) => {
      if (!alive) return
      setWorkbench(next)
      setActivePath(next.files[0]?.path || '')
      setDrafts(Object.fromEntries(next.files.map((file) => [file.path, { content: file.current, exists: file.current_exists, resolved: false }])))
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { alive = false }
  }, [session.id, session.integration_conflict?.id])

  const file = workbench?.files.find((candidate) => candidate.path === activePath)
  const draft = activePath ? drafts[activePath] : undefined
  const resolvedCount = Object.values(drafts).filter((item) => item.resolved).length
  const allResolved = Boolean(workbench?.files.length) && resolvedCount === workbench?.files.length
  const locked = busy || submitting
  const resolvedPayload = useMemo<ConflictManualResolution[]>(() => Object.entries(drafts)
    .filter(([, item]) => item.resolved)
    .map(([path, item]) => ({ path, content: item.content, exists: item.exists })), [drafts])

  function updateDraft(patch: Partial<Draft>) {
    if (!activePath || !draft) return
    setDrafts((current) => ({ ...current, [activePath]: { ...current[activePath], ...patch } }))
  }
  function accept(content: string, exists: boolean) { updateDraft({ content, exists, resolved: true }) }

  async function applyManual() {
    if (!allResolved) return
    setSubmitting(true); setError('')
    try {
      const result = await api.resolveConflictManually(session.id, resolvedPayload)
      onSession(result.session)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSubmitting(false) }
  }

  async function delegateRemaining() {
    setSubmitting(true); setError('')
    try {
      const updated = await api.delegateConflictToGPT(session.id, resolvedPayload, guidance)
      onSession(updated)
      onClose()
      await onDelegateToGPT(updated)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSubmitting(false) }
  }

  return <InternalWindow title="Resolução manual de conflito" layerClassName="diff-inspector-backdrop conflict-resolver-backdrop" onClose={onClose} closeDisabled={locked}>
    <section className="conflict-resolver" role="dialog" aria-modal="false" aria-label="Resolução manual de conflito">
      <header className="conflict-resolver-header">
        <div><span className="panel-kicker">Merge manual</span><strong>Resolver conflito</strong><span>Local · Consolidação editável · Remota</span></div>
        <div><StatusPill tone={allResolved ? 'success' : 'warning'}>{resolvedCount}/{workbench?.files.length || 0} resolvido(s)</StatusPill><button className="icon-button light" disabled={locked} onClick={onClose} aria-label="Fechar resolução"><Icon name="close" size={14}/></button></div>
      </header>
      {error && <div className="conflict-resolver-error">{error}</div>}
      {!workbench ? <div className="change-diff-loading">A carregar versões do conflito…</div> : <>
        <div className="conflict-file-tabs" role="tablist" aria-label="Ficheiros em conflito">
          {workbench.files.map((candidate) => <button key={candidate.path} role="tab" aria-selected={candidate.path === activePath} className={candidate.path === activePath ? 'active' : ''} onClick={() => setActivePath(candidate.path)}><span>{drafts[candidate.path]?.resolved ? '✓' : '•'}</span>{candidate.path}</button>)}
        </div>
        {file && draft && <div className="conflict-merge-grid">
          <ConflictPane title="Local" subtitle={file.current_exists ? 'Versão no host' : 'Ficheiro ausente'} actionLabel="Aceitar local" onAccept={() => accept(file.current, file.current_exists)}>
            <CodeEditor path={`.wharnex-conflict/current/${file.path}`} value={file.current} onChange={() => undefined} onSave={() => undefined} onCursorChange={() => undefined} readOnly/>
          </ConflictPane>
          <ConflictPane title="Consolidação" subtitle={draft.exists ? (draft.resolved ? 'Marcado como resolvido' : 'Edite e confirme') : 'Ficheiro será removido'} center>
            <CodeEditor path={`.wharnex-conflict/result/${file.path}`} value={draft.content} onChange={(content) => updateDraft({ content, exists: true, resolved: false })} onSave={() => updateDraft({ resolved: true })} onCursorChange={() => undefined}/>
            <div className="conflict-result-actions"><button className="secondary-button" onClick={() => updateDraft({ resolved: true })}>Marcar edição como resolvida</button>{(!file.current_exists || !file.incoming_exists) && <button className="text-button danger" onClick={() => updateDraft({ content: '', exists: false, resolved: true })}>Resolver como removido</button>}</div>
          </ConflictPane>
          <ConflictPane title="Remota" subtitle={file.incoming_exists ? 'Versão concorrente' : 'Ficheiro ausente'} actionLabel="Aceitar remota" onAccept={() => accept(file.incoming, file.incoming_exists)}>
            <CodeEditor path={`.wharnex-conflict/incoming/${file.path}`} value={file.incoming} onChange={() => undefined} onSave={() => undefined} onCursorChange={() => undefined} readOnly/>
          </ConflictPane>
        </div>}
        {file && <details className="conflict-base"><summary>Ver base comum</summary><pre>{file.base_exists ? file.base : 'Ficheiro inexistente na base.'}</pre></details>}
      </>}
      <footer className="conflict-resolver-footer">
        <div><span>As decisões manuais ficam bloqueadas se delegar o restante ao GPT.</span><textarea className="conflict-guidance" value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Instrução auxiliar opcional para o GPT…" rows={2}/></div>
        <div><button className="text-button" disabled={locked} onClick={onClose}>Cancelar</button><button className="secondary-button" disabled={locked || !workbench || allResolved || resolvedCount === 0} onClick={() => void delegateRemaining()}><Icon name="chatgpt" size={14}/> Delegar restantes ao GPT</button><button className="apply-button" disabled={locked || !allResolved} onClick={() => void applyManual()}><Icon name="apply" size={14}/> Aplicar resolução manual</button></div>
      </footer>
    </section>
  </InternalWindow>
}

function ConflictPane({ title, subtitle, actionLabel, onAccept, center = false, children }: { title: string; subtitle: string; actionLabel?: string; onAccept?: () => void; center?: boolean; children: ReactNode }) {
  return <section className={`conflict-pane ${center ? 'result' : ''}`}><header><div><strong>{title}</strong><span>{subtitle}</span></div>{actionLabel && <button className="secondary-button" onClick={onAccept}>{actionLabel}</button>}</header><div className="conflict-editor">{children}</div></section>
}
