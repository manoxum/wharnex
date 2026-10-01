import { useEffect, useMemo, useState } from 'react'
import type { ActivationImpact, ChatChangeSummary } from '../../../types'
import { mergeRestartImpacts, type RestartReport } from '../../../lib/execution/recovery/restartConfirmation'
import { GitDiffReview } from '../../git/review/GitDiffReview'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'

type RestartConfirmationProps = {
  reports?: RestartReport[]
  sessionId?: string
  change?: ChatChangeSummary
  impacts?: ActivationImpact[]
  busy: boolean
  onLater: () => void
  onActivate: (impacts: ActivationImpact[]) => void
}

const impactLabels: Record<ActivationImpact, string> = { backend: 'Backend', frontend: 'Frontend', desktop: 'Desktop', tunnel: 'Túnel' }

export function RestartConfirmation({ reports: suppliedReports, sessionId, change, impacts: suppliedImpacts = [], busy, onLater, onActivate }: RestartConfirmationProps) {
  const reports = useMemo<RestartReport[]>(() => suppliedReports?.length ? suppliedReports : sessionId ? [{ sessionId, chatId: sessionId, chatTitle: 'Conclusão atual', change, impacts: suppliedImpacts }] : [], [suppliedReports, sessionId, change, suppliedImpacts])
  const impacts = useMemo(() => mergeRestartImpacts(reports), [reports])
  const [selectedSessionId, setSelectedSessionId] = useState(reports[0]?.sessionId || '')
  const selectedReport = reports.find((report) => report.sessionId === selectedSessionId) || reports[0]
  const files = selectedReport?.change?.files ?? []
  const totals = useMemo(() => reports.flatMap((report) => report.change?.files ?? []).reduce((current, file) => ({
    additions: current.additions + file.additions,
    deletions: current.deletions + file.deletions,
    files: current.files + 1,
  }), { additions: 0, deletions: 0, files: 0 }), [reports])

  useEffect(() => {
    if (!selectedReport && reports[0]) setSelectedSessionId(reports[0].sessionId)
  }, [reports, selectedReport])

  return <InternalWindow title="Ativar nova versão" layerClassName="restart-confirmation-backdrop" onClose={onLater} closeDisabled={busy}>
    <section className="restart-confirmation-dialog" role="dialog" aria-modal="false" aria-labelledby="restart-confirmation-title">
      <header className="restart-confirmation-hero">
        <div className="restart-confirmation-icon"><Icon name="refresh" size={20}/></div>
        <div className="restart-confirmation-copy">
          <span className="panel-kicker">Auto-evolução concluída</span>
          <h2 id="restart-confirmation-title">Como ativar a nova versão?</h2>
          <p>{reports.length === 1 ? 'O build terminou com sucesso. Pode ativar agora ou deixar a nova versão pronta.' : `${reports.length} conclusões foram acumuladas no mesmo lote.`} Reveja os relatórios e ative uma única vez apenas os componentes afetados.</p>
        </div>
        <span className="restart-confirmation-state"><Icon name="check" size={13}/> {reports.length === 1 ? 'Build concluído' : `${reports.length} relatórios`}</span>
      </header>

      <div className={`restart-confirmation-overview${selectedReport?.change?.summary ? '' : ' single'}`}>
        <section className="restart-confirmation-card restart-confirmation-scope" aria-label="Componentes afetados">
          <div className="restart-confirmation-card-heading">
            <span className="restart-confirmation-summary-label">Componentes acumulados</span>
            <small>{impacts.length ? `${impacts.length} selecionado${impacts.length === 1 ? '' : 's'}` : 'Sem reinício necessário'}</small>
          </div>
          <div className="restart-confirmation-impact-list">
            {impacts.length
              ? impacts.map((impact) => <span key={impact}><span className="restart-confirmation-impact-dot"/>{impactLabels[impact]}</span>)
              : <span className="restart-confirmation-impact-empty">Nenhum serviço em execução</span>}
          </div>
        </section>

        {selectedReport?.change?.summary && <aside className="restart-confirmation-card restart-confirmation-work-summary" aria-label="Resumo da alteração">
          <span className="restart-confirmation-summary-icon"><Icon name="check" size={15}/></span>
          <div>
            <span className="restart-confirmation-summary-label">O que foi feito{reports.length > 1 ? ` · ${selectedReport.chatTitle}` : ''}</span>
            <p>{selectedReport.change.summary}</p>
          </div>
        </aside>}
      </div>

      <section className="restart-confirmation-changes" aria-labelledby="restart-confirmation-changes-title">
        <header>
          <div className="restart-confirmation-changes-copy">
            <span className="panel-kicker">Fecho acumulado</span>
            <strong id="restart-confirmation-changes-title">{reports.length === 1 ? 'Alterações desta versão' : 'Relatórios de conclusão'}</strong>
            <small>Troque de relatório para rever os diffs que compõem esta ativação única.</small>
          </div>
          <span className="restart-confirmation-total"><b>{totals.files}</b> ficheiro(s)<i>+{totals.additions}</i><em>−{totals.deletions}</em></span>
        </header>
        <nav className="restart-confirmation-report-tabs" aria-label="Relatórios acumulados">
          {reports.map((report) => <button
            type="button"
            key={report.sessionId}
            className={report.sessionId === selectedReport?.sessionId ? 'active' : ''}
            onClick={() => setSelectedSessionId(report.sessionId)}
          >
            <span>{report.chatTitle}</span>
            <small>{report.change?.files.length || 0} ficheiro(s) · {report.impacts.map((impact) => impactLabels[impact]).join(' + ') || 'sem serviço'}</small>
          </button>)}
        </nav>
        {selectedReport && <GitDiffReview sessionId={selectedReport.sessionId} files={files} emptyText="Nenhum diff de ficheiro foi registado para esta conclusão."/>}
      </section>

      <footer className="restart-confirmation-actions restart-scope-actions">
        <span className="restart-confirmation-action-note">Pode continuar a acumular conclusões ou ativar agora todo o lote numa única operação.</span>
        <div className="restart-confirmation-action-buttons">
          <button className="secondary-button" disabled={busy} onClick={onLater}>Mais tarde</button>
          <button className="apply-button" disabled={busy} onClick={() => onActivate(impacts)}><Icon name="refresh" size={14}/> {impacts.includes('desktop') ? 'Reiniciar Desktop agora' : impacts.length === 1 && impacts[0] === 'frontend' ? 'Recarregar frontend agora' : reports.length > 1 ? 'Aplicar lote agora' : 'Aplicar agora'}</button>
        </div>
      </footer>
    </section>
  </InternalWindow>
}
