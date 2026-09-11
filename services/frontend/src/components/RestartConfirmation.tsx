import { useMemo, useState } from 'react'
import type { ChatChangeSummary } from '../types'
import { ChangeDiffEditor } from './ChangeDiffEditor'
import { Icon } from './Icon'

type RestartConfirmationProps = {
  sessionId: string
  change?: ChatChangeSummary
  busy: boolean
  onLater: () => void
  onRestart: (scope: 'all' | 'current') => void
}

export function RestartConfirmation({ sessionId, change, busy, onLater, onRestart }: RestartConfirmationProps) {
  const files = change?.files ?? []
  const [selectedPath, setSelectedPath] = useState(files[0]?.path || '')
  const selected = files.find((file) => file.path === selectedPath) || files[0]
  const totals = useMemo(() => files.reduce((current, file) => ({
    additions: current.additions + file.additions,
    deletions: current.deletions + file.deletions,
  }), { additions: 0, deletions: 0 }), [files])

  return <div className="restart-confirmation-backdrop" data-chatgpt-overlay-blocker="true" role="presentation">
    <section className="restart-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="restart-confirmation-title">
      <div className="restart-confirmation-icon"><Icon name="refresh" size={24}/></div>
      <div className="restart-confirmation-copy">
        <span className="panel-kicker">Auto-evolução concluída</span>
        <h2 id="restart-confirmation-title">Como ativar a nova versão?</h2>
        <p>O host já foi atualizado, a revisão final do ChatGPT foi recebida e o conhecimento foi processado. Confirme quando deseja ativar a runtime reconstruída.</p>
      </div>
      {/* The planner's own short description of the delivered work. The protocol
          requires it on every plan-bearing response, so the operator is never
          asked to restart the runtime without being told what changed. */}
      {change?.summary && <p className="restart-confirmation-summary" aria-label="Resumo da alteração">{change.summary}</p>}
      <section className="restart-confirmation-changes" aria-labelledby="restart-confirmation-changes-title">
        <header>
          <div><span className="panel-kicker">Fecho da alteração</span><strong id="restart-confirmation-changes-title">Alterações desta versão</strong></div>
          <span>{files.length} ficheiro(s) · <b>+{totals.additions}</b> <i>−{totals.deletions}</i></span>
        </header>
        {selected ? <div className="restart-confirmation-diff-layout">
          <nav className="restart-confirmation-files" aria-label="Ficheiros alterados">
            {files.map((file) => <button key={file.path} type="button" className={file.path === selected.path ? 'active' : ''} aria-label={file.path} onClick={() => setSelectedPath(file.path)}>
              <span>{file.path}</span><small><b>+{file.additions}</b> <i>−{file.deletions}</i></small>
            </button>)}
          </nav>
          <div className="restart-confirmation-diff-view">
            <div className="restart-confirmation-diff-heading"><code>{selected.path}</code><span><b>+{selected.additions}</b> <i>−{selected.deletions}</i></span></div>
            <ChangeDiffEditor sessionId={sessionId} file={selected}/>
          </div>
        </div> : <div className="restart-confirmation-empty-diff">Nenhum diff de ficheiro foi registado para esta ativação.</div>}
      </section>
      <div className="restart-confirmation-actions restart-scope-actions">
        <button className="secondary-button" disabled={busy} onClick={onLater}>Mais tarde</button>
        <button className="secondary-button" disabled={busy} onClick={() => onRestart('current')}><Icon name="refresh" size={14}/> Apenas esta</button>
        <button className="apply-button" disabled={busy} onClick={() => onRestart('all')}><Icon name="refresh" size={14}/> Todas agora</button>
      </div>
    </section>
  </div>
}
