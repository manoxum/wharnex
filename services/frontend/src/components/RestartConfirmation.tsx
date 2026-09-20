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

function pathParts(path: string) {
  const parts = path.split('/')
  const name = parts.pop() || path
  return { name, directory: parts.join('/') }
}

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
      <header className="restart-confirmation-hero">
        <div className="restart-confirmation-icon"><Icon name="refresh" size={20}/></div>
        <div className="restart-confirmation-copy">
          <span className="panel-kicker">Auto-evolução concluída</span>
          <h2 id="restart-confirmation-title">Como ativar a nova versão?</h2>
          <p>O build terminou com sucesso. Reveja o que mudou e ative apenas os componentes afetados quando estiver pronto.</p>
        </div>
        <span className="restart-confirmation-state"><Icon name="check" size={13}/> Build concluído</span>
      </header>

      <div className={`restart-confirmation-overview${change?.summary ? '' : ' single'}`}>
        <section className="restart-confirmation-card restart-confirmation-scope" aria-label="Componentes afetados">
          <div className="restart-confirmation-card-heading">
            <span className="restart-confirmation-summary-label">Componentes afetados</span>
            <small>{impacts.length ? `${impacts.length} selecionado${impacts.length === 1 ? '' : 's'}` : 'Sem reinício necessário'}</small>
          </div>
          <div className="restart-confirmation-impact-list">
            {impacts.length
              ? impacts.map((impact) => <span key={impact}><span className="restart-confirmation-impact-dot"/>{impactLabels[impact]}</span>)
              : <span className="restart-confirmation-impact-empty">Nenhum serviço em execução</span>}
          </div>
        </section>

        {change?.summary && <aside className="restart-confirmation-card restart-confirmation-work-summary" aria-label="Resumo da alteração">
          <span className="restart-confirmation-summary-icon"><Icon name="check" size={15}/></span>
          <div>
            <span className="restart-confirmation-summary-label">O que foi feito</span>
            <p>{change.summary}</p>
          </div>
        </aside>}
      </div>

      <section className="restart-confirmation-changes" aria-labelledby="restart-confirmation-changes-title">
        <header>
          <div className="restart-confirmation-changes-copy">
            <span className="panel-kicker">Fecho da alteração</span>
            <strong id="restart-confirmation-changes-title">Alterações desta versão</strong>
            <small>Selecione um ficheiro para comparar a versão anterior com a versão aplicada.</small>
          </div>
          <span className="restart-confirmation-total"><b>{files.length}</b> ficheiro(s)<i>+{totals.additions}</i><em>−{totals.deletions}</em></span>
        </header>
        {selected ? <div className="restart-confirmation-diff-layout">
          <nav className="restart-confirmation-files" aria-label="Ficheiros alterados">
            {files.map((file) => {
              const label = pathParts(file.path)
              return <button key={file.path} type="button" className={file.path === selected.path ? 'active' : ''} aria-label={file.path} title={file.path} onClick={() => setSelectedPath(file.path)}>
                <span className="restart-confirmation-file-copy"><strong>{label.name}</strong>{label.directory && <small>{label.directory}</small>}</span>
                <span className="restart-confirmation-file-stats"><b>+{file.additions}</b><i>−{file.deletions}</i></span>
              </button>
            })}
          </nav>
          <div className="restart-confirmation-diff-view">
            <div className="restart-confirmation-diff-heading">
              <code>{selected.path}</code>
              <span><b>+{selected.additions}</b><i>−{selected.deletions}</i></span>
            </div>
            <ChangeDiffEditor sessionId={sessionId} file={selected}/>
          </div>
        </div> : <div className="restart-confirmation-empty-diff">Nenhum diff de ficheiro foi registado para esta ativação.</div>}
      </section>

      <footer className="restart-confirmation-actions restart-scope-actions">
        <span className="restart-confirmation-action-note">Pode ativar agora ou deixar a nova versão pronta para mais tarde.</span>
        <div className="restart-confirmation-action-buttons">
          <button className="secondary-button" disabled={busy} onClick={onLater}>Mais tarde</button>
          <button className="apply-button" disabled={busy} onClick={() => onActivate(impacts)}><Icon name="refresh" size={14}/> {impacts.includes('desktop') ? 'Reiniciar Desktop agora' : impacts.length === 1 && impacts[0] === 'frontend' ? 'Recarregar frontend agora' : 'Aplicar agora'}</button>
        </div>
      </footer>
    </section>
  </div>
}
