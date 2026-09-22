import { useMemo, useState, type ReactNode } from 'react'
import type { HarnessEvent, Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { collectPlanActivities, mainRequestRoot, sessionForPlan } from '../lib/projectActivity'
import { riskLabel } from '../lib/risk'
import { activityExportFilename, buildMainPlanExport, buildSubplanExport, downloadActivityExport } from '../lib/activityExport'
import { formatActivityDate, shortPlanId, shortRequestId } from '../lib/activityFormat'
import { Icon } from './Icon'
import { HistoryExportButton } from './HistoryExportButton'

type PlanGroup = { rootRequestId: string; plans: ReturnType<typeof collectPlanActivities>; updatedAt: string }

export function PlanHistorySurface({ session, chat, events, loading, error, currentPlan, renderHistoricalPlan }: {
  session: Session
  chat?: WorkspaceChat
  events: HarnessEvent[]
  loading: boolean
  error: string
  currentPlan: ReactNode
  renderHistoricalPlan: (session: Session) => ReactNode
}) {
  const historyChat = useMemo<WorkspaceChat>(() => chat || ({ id: session.id, title: 'Chat atual', sessionId: session.id, createdAt: session.created_at, updatedAt: session.created_at }), [chat, session.created_at, session.id])
  const items = useMemo(() => collectPlanActivities([{ chat: historyChat, session }], { [historyChat.id]: events }), [events, historyChat, session])
  const groups = useMemo(() => groupPlans(items, session), [items, session])
  if (!groups.length) return <>{loading && <AuditHistoryNotice text="A carregar histórico durável de planos…"/>}{error && <AuditHistoryNotice text={error} danger/>}{currentPlan}</>
  return <div className="main-request-history plan-history">
    <AuditHistoryNotice text={loading ? 'A atualizar o histórico durável de planos…' : `${groups.length} Main Request(s) com plano registado.`} danger={Boolean(error)}/>
    {error && <AuditHistoryNotice text={error} danger/>}
    {groups.map((group, index) => <PlanHistoryBlock key={group.rootRequestId} group={group} session={session} currentPlan={currentPlan} renderHistoricalPlan={renderHistoricalPlan} defaultOpen={index === 0}/>) }
  </div>
}

function PlanHistoryBlock({ group, session, currentPlan, renderHistoricalPlan, defaultOpen }: { group: PlanGroup; session: Session; currentPlan: ReactNode; renderHistoricalPlan: (session: Session) => ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const lead = group.plans[0]?.plan
  const exportGroup = () => downloadActivityExport(activityExportFilename('plano', group.rootRequestId), buildMainPlanExport(group.rootRequestId, group.plans))
  return <details className="main-request-block plan-history-block" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="main-request-summary">
      <span className="main-request-summary-mark"><Icon name="plan" size={14}/></span>
      <span className="main-request-summary-copy"><span className="panel-kicker">Main Request · plano</span><strong>{lead?.summary || 'Histórico de planos'}</strong><small>{formatActivityDate(group.updatedAt)} · {group.plans.length} {group.plans.length === 1 ? 'subplano' : 'subplanos'}</small></span>
      <span className="main-request-summary-meta"><span className="history-summary-context"><code title={group.rootRequestId}>{shortRequestId(group.rootRequestId)}</code><span className="history-count">{group.plans.length}</span></span><span className="history-summary-actions"><HistoryExportButton label="Exportar plano" onExport={exportGroup}/><span className="history-chevron"><Icon name="chevron-right" size={14}/></span></span></span>
    </summary>
    {open && <div className="main-request-plan-list">{group.plans.map((item, planIndex) => {
      const current = item.plan.plan_id === session.plan?.plan_id
      const sequence = group.plans.length - planIndex
      return <PlanHistoryLine key={item.id} item={item} sequence={sequence} rootRequestId={group.rootRequestId} defaultOpen={current}>{current ? <div className="history-current-plan">{currentPlan}</div> : renderHistoricalPlan(sessionForPlan(item))}</PlanHistoryLine>
    })}</div>}
  </details>
}

function PlanHistoryLine({ item, sequence, rootRequestId, defaultOpen, children }: { item: ReturnType<typeof collectPlanActivities>[number]; sequence: number; rootRequestId: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const label = `Subplano ${String(sequence).padStart(2, '0')}`
  const exportItem = () => downloadActivityExport(activityExportFilename('subplano', item.plan.plan_id), buildSubplanExport(item, sequence, rootRequestId))
  return <details className="main-request-plan-row" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="main-request-plan-summary">
      <span className="plan-history-sequence">{String(sequence).padStart(2, '0')}</span>
      <span className="main-request-plan-copy"><span className="panel-kicker">{label} · {item.label}</span><strong>{item.plan.summary || 'Plano de execução'}</strong><small>{formatActivityDate(item.timestamp)} · {item.plan.protocol} · risco {riskLabel(item.plan.risk).toLocaleLowerCase()}</small></span>
      <span className="main-request-plan-meta"><span className="history-summary-context"><code title={item.plan.plan_id}>{shortPlanId(item.plan.plan_id)}</code></span><span className="history-summary-actions"><HistoryExportButton label={`Exportar ${label.toLocaleLowerCase()}`} onExport={exportItem}/><span className="history-chevron"><Icon name="chevron-right" size={13}/></span></span></span>
    </summary>
    {open && <div className="main-request-plan-detail">{children}</div>}
  </details>
}

function groupPlans(items: ReturnType<typeof collectPlanActivities>, session: Session) {
  const grouped = new Map<string, typeof items>()
  for (const item of items) {
    const root = mainRequestRoot(session, item.plan.request_id) || item.plan.request_id
    const bucket = grouped.get(root) || []
    bucket.push(item); grouped.set(root, bucket)
  }
  return [...grouped].map(([rootRequestId, plans]) => ({ rootRequestId, plans: plans.sort((a, b) => b.timestamp.localeCompare(a.timestamp)), updatedAt: plans[0]?.timestamp || '' })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function AuditHistoryNotice({ text, danger = false }: { text: string; danger?: boolean }) {
  return <div className={`audit-history-notice${danger ? ' danger' : ''}`}><Icon name="history" size={13}/><span>{text}</span></div>
}
