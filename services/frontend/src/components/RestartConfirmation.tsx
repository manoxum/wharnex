import { useMemo, useState } from 'react'
import type { ActivationImpact, ChatChangeSummary } from '../types'
import { ChangeDiffEditor } from './ChangeDiffEditor'
import { Icon } from './Icon'

type RestartConfirmationProps = {
  sessionId: string
  change?: ChatChangeSummary
  impacts: ActivationImpact[]
  busy: boolean
  onLater: () => void
  onActivate: (impacts: ActivationImpact[]) => void
}

const impactLabels: Record<ActivationImpact, string> = { backend: 'Backend', frontend: 'Frontend', desktop: 'Desktop', tunnel: 'Túnel' }

export function RestartConfirmation({ sessionId, change, impacts, busy, onLater, onActivate }: RestartConfirmationProps) {
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
        <p>O build já foi concluído. Confirme quando deseja aplicar apenas os componentes afetados.</p>
      </div>
      <div className="restart-confirmation-summary" aria-label="Componentes afetados">
        <div><span className="restart-confirmation-summary-label">Componentes afetados</span><p>{impacts.length ? impacts.map((impact) => impactLabels[impact]).join(' · ') : 'Nenhum serviço em execução'}</p></div>
      </div>
      {/* The planner's own short description of the delivered work. The protocol
          requires it on every plan-bearing response, so the operator is never
          asked to restart the runtime without being told what changed. */}
      {change?.summary && <aside className="restart-confirmation-summary" aria-label="Resumo da alteração">
        <span className="restart-confirmation-summary-icon"><Icon name="check" size={16}/></span>
        <div>
          <span className="restart-confirmation-summary-label">O que foi feito</span>
          <p>{change.summary}</p>
        </div>
      </aside>}
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
        <button className="apply-button" disabled={busy} onClick={() => onActivate(impacts)}><Icon name="refresh" size={14}/> {impacts.includes('desktop') ? 'Reiniciar Desktop agora' : impacts.length === 1 && impacts[0] === 'frontend' ? 'Recarregar frontend agora' : 'Aplicar agora'}</button>
      </div>
    </section>
  </div>
}
