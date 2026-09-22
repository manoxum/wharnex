import { useEffect, useMemo, useRef, useState } from 'react'
import type { HarnessEvent, Session } from '../types'
import { buildExecutionTimeline, groupExecutionSubtasks, type ExecutionSubtaskGroup, type ExecutionTimelineEntry, type ExecutionTimelineOverview } from '../lib/executionTimeline'
import { groupMainRequestActivity } from '../lib/projectActivity'
import { activityExportFilename, buildMainExecutionExport, buildSubexecutionExport, downloadActivityExport } from '../lib/activityExport'
import { formatActivityDate, formatActivityDuration, shortRequestId } from '../lib/activityFormat'
import { filterExecutionAuditEvents } from '../lib/executionAudit'
import { currentMainRequestRoot, executionActivityOverview } from '../lib/executionActivityStatus'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import { HistoryExportButton } from './HistoryExportButton'
import { AuditHistoryNotice } from './PlanHistorySurface'
import { ContentSkeleton } from './Skeleton'

export function ExecutionHistorySurface({ session, events, loading, error }: { session: Session; events: HarnessEvent[]; loading: boolean; error: string }) {
  const groups = useMemo(() => groupMainRequestActivity(session, events).map((group) => ({ ...group, events: filterExecutionAuditEvents(group.events) })).filter((group) => group.events.length), [events, session])
  const activeRequestId = String(session.last_request_id || '').trim()
  const activeRootRequestId = currentMainRequestRoot(session)
  if (!groups.length) return <>{loading && <ContentSkeleton label="A carregar histórico de execução" rows={5}/>} {error && <AuditHistoryNotice text={error} danger/>}{!loading && <TerminalView events={[]} />}</>
  return <div className="main-request-history execution-history">
    <AuditHistoryNotice text={loading ? 'A atualizar o histórico durável de execução…' : `${groups.length} Main Request(s) com atividade de execução auditável.`} danger={Boolean(error)}/>
    {error && <AuditHistoryNotice text={error} danger/>}
    {groups.map((group, index) => <ExecutionHistoryBlock key={group.rootRequestId} group={group} defaultOpen={index === 0} allowActive={group.rootRequestId === activeRootRequestId} activeRequestId={group.rootRequestId === activeRootRequestId ? activeRequestId : ''}/>) }
  </div>
}

function ExecutionHistoryBlock({ group, defaultOpen, allowActive, activeRequestId }: { group: ReturnType<typeof groupMainRequestActivity>[number]; defaultOpen: boolean; allowActive: boolean; activeRequestId: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const entries = useMemo(() => buildExecutionTimeline(group.events), [group.events])
  const subtasks = useMemo(() => groupExecutionSubtasks(entries), [entries])
  const visibleSubtasks = useMemo(() => subtasks.map((subtask) => {
    const overview = executionActivityOverview(subtask.entries, allowActive, activeRequestId)
    return overview === subtask.overview ? subtask : { ...subtask, overview }
  }), [activeRequestId, allowActive, subtasks])
  const overview = executionActivityOverview(entries, allowActive, activeRequestId)
  const status = executionStatus(overview)
  const exportGroup = () => downloadActivityExport(activityExportFilename('execucao', group.rootRequestId), buildMainExecutionExport(group.rootRequestId, group.updatedAt, visibleSubtasks))
  return <details className={`main-request-block execution-main-request tone-${overview}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="main-request-summary">
      <span className="main-request-summary-mark"><Icon name="terminal" size={14}/></span>
      <span className="main-request-summary-copy"><span className="panel-kicker">Main Request · execução</span><strong>{status}</strong><small>{formatActivityDate(group.updatedAt)} · {visibleSubtasks.length || group.requestIds.length || 1} subtarefa(s) · {group.events.length} eventos</small></span>
      <span className="main-request-summary-meta"><span className="history-summary-context"><code title={group.rootRequestId}>{shortRequestId(group.rootRequestId)}</code><span className="history-count">{visibleSubtasks.length || group.requestIds.length || 1}</span></span><span className="history-summary-actions"><HistoryExportButton label="Exportar execução" onExport={exportGroup}/><span className="history-chevron"><Icon name="chevron-right" size={14}/></span></span></span>
    </summary>
    {open && <div className="main-request-execution-detail"><TerminalView events={group.events} compact allowActive={allowActive} activeRequestId={activeRequestId}/></div>}
  </details>
}

export function TerminalView({ events, compact = false, allowActive = true, activeRequestId = '' }: { events: HarnessEvent[]; compact?: boolean; allowActive?: boolean; activeRequestId?: string }) {
  const entries = useMemo(() => buildExecutionTimeline(events), [events])
  const subtasks = useMemo(() => groupExecutionSubtasks(entries), [entries])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const expandable = entries.filter((entry) => (entry.kind === 'command' || entry.kind === 'patch') && (entry.output || entry.rationale)).slice(-5)
    setExpanded(new Set(expandable.map((entry) => entry.id)))
    if (!compact) endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [])
  useEffect(() => { if (!compact) endRef.current?.scrollIntoView?.({ block: 'end' }) }, [compact, events.length])
  if (!events.length) return <ExecutionEmpty/>
  const overview = executionActivityOverview(entries, allowActive, activeRequestId)
  return <div className="execution-view">
    {!compact && <div className="execution-overview"><div><span className="panel-kicker">Execução observável</span><h3>{executionOverviewTitle(overview)}</h3><p>Expanda uma subtarefa para consultar comandos, propósito, stdout, stderr, erros, data/hora e duração.</p></div><StatusPill tone={overview === 'failed' ? 'danger' : overview === 'active' || overview === 'waiting' ? 'warning' : 'success'}>{executionStatus(overview)}</StatusPill></div>}
    <div className="execution-timeline execution-subtask-list">
      {subtasks.map((group, index) => {
        const overview = executionActivityOverview(group.entries, allowActive, activeRequestId)
        const visibleGroup = overview === group.overview ? group : { ...group, overview }
        return <ExecutionSubtaskBlock key={group.id} group={visibleGroup} sequence={index + 1} defaultOpen={overview === 'active' || overview === 'waiting' || index === subtasks.length - 1} expanded={expanded} onToggleEntry={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })}/>
      })}
      <div ref={endRef}/>
    </div>
  </div>
}

function ExecutionSubtaskBlock({ group, sequence, defaultOpen, expanded, onToggleEntry }: { group: ExecutionSubtaskGroup; sequence: number; defaultOpen: boolean; expanded: Set<string>; onToggleEntry: (id: string) => void }) {
  const [open, setOpen] = useState(defaultOpen)
  const requestId = group.requestId || group.rootRequestId
  const exportGroup = () => downloadActivityExport(activityExportFilename('subexecucao', requestId), buildSubexecutionExport(group, sequence))
  return <details className={`execution-subtask tone-${group.overview}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="execution-subtask-summary">
      <span className="execution-subtask-index">{String(sequence).padStart(2, '0')}</span>
      <span className="execution-subtask-copy"><span className="panel-kicker">Subexecução {String(sequence).padStart(2, '0')}</span><strong>{executionKindLabel(group.iterationKind)}</strong><small>{formatActivityDate(group.updatedAt)} · {group.entries.length} {group.entries.length === 1 ? 'evento' : 'eventos'}</small></span>
      <span className="execution-subtask-meta"><span className="history-summary-context"><code title={requestId}>{shortRequestId(requestId)}</code><span className={`history-status tone-${group.overview}`}>{executionStatus(group.overview)}</span></span><span className="history-summary-actions"><HistoryExportButton label={`Exportar subexecução ${sequence}`} onExport={exportGroup}/><span className="history-chevron"><Icon name="chevron-right" size={13}/></span></span></span>
    </summary>
    {open && <div className="execution-subtask-events">{group.entries.map((entry) => <ExecutionEntryCard key={entry.id} entry={entry} expanded={expanded.has(entry.id)} onToggle={() => onToggleEntry(entry.id)}/>)}</div>}
  </details>
}

function ExecutionEntryCard({ entry, expanded, onToggle }: { entry: ExecutionTimelineEntry; expanded: boolean; onToggle: () => void }) {
  const canExpand = Boolean(entry.output || entry.rationale)
  return <div className={`execution-command-card ${entry.running ? 'running' : ''}`}><div className="execution-event"><span className={`lamp ${entry.tone === 'fail' ? 'fail' : entry.tone === 'warning' ? 'warning' : ''} ${entry.running ? 'blinking' : ''}`} /><div className="execution-event-copy"><strong>{entry.title}</strong><span>{formatActivityDate(entry.timestamp)}{entry.detail ? ` · ${entry.detail}` : ''}{entry.durationMs !== undefined ? ` · ${formatActivityDuration(entry.durationMs)}` : ''}</span></div><div className="execution-event-actions"><code>{entry.badge}</code>{canExpand && <button type="button" className={expanded ? 'execution-expand open' : 'execution-expand'} onClick={onToggle} title={expanded ? 'Ocultar detalhes' : 'Mostrar detalhes'} aria-label={expanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}><Icon name="chevron-right" size={12}/></button>}</div></div>{canExpand && expanded && <div className="execution-command-output" role="log" aria-label="Detalhes da execução">{entry.rationale && <div className="execution-rationale"><strong>Porquê / propósito</strong><span>{entry.rationale}</span></div>}{entry.outputSegments.length ? entry.outputSegments.map((segment, index) => <pre key={`${entry.id}-output-${index}`} className={`execution-output-segment ${segment.stream}`} data-stream={segment.stream} aria-label={segment.stream === 'stderr' ? 'stderr' : undefined}>{segment.text}</pre>) : entry.output ? <pre className="execution-output-segment meta">{entry.output}</pre> : null}</div>}</div>
}

function executionStatus(overview: ExecutionTimelineOverview) { return overview === 'active' ? 'Em curso' : overview === 'waiting' ? 'A aguardar' : overview === 'failed' ? 'Falhou' : overview === 'recovered' ? 'Recuperada' : overview === 'success' ? 'Concluída' : 'Registada' }
function executionOverviewTitle(overview: ExecutionTimelineOverview) { return overview === 'active' ? 'Operação em curso' : overview === 'waiting' ? 'A aguardar continuação' : overview === 'failed' ? 'Execução com falha' : overview === 'recovered' ? 'Execução recuperada' : overview === 'success' ? 'Execução concluída' : 'Atividade de execução' }
function executionKindLabel(kind: ExecutionSubtaskGroup['iterationKind']) { return kind === 'repair' ? 'Resolução de erro' : kind === 'revert_restore' ? 'Reposição de reversão' : kind === 'improvement' ? 'Melhoria contínua' : kind === 'evidence' ? 'Extração de informações' : kind === 'conflict' ? 'Resolução de conflito' : 'Execução principal' }
function ExecutionEmpty() { return <div className="empty-state"><div className="empty-mark">K/</div><h3>Execução limpa</h3><p>Operações, verificações, aplicação no host, stdout e stderr aparecerão aqui em tempo real. O terminal interativo continua no modo Editor.</p></div> }
