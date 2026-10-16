import { useMemo } from 'react'
import type { HarnessEvent, Session } from '../../../../types'
import { mergeAuditEvents } from '../../../../lib/project/context/projectActivity'
import { useExecutionHistory } from '../../../execution/history/useExecutionHistory'
import { ExecutionHistorySurface } from '../../../execution/history/ExecutionHistorySurface'
import { EmptyState } from '../../../presentation/workbench'

export function OperationalOutput({ session, events, active }: { session: Session; events: HarnessEvent[]; active: boolean }) {
  const { events: history, loading, error } = useExecutionHistory(session, active ? 'terminal' : 'inactive')
  const auditEvents = useMemo(() => mergeAuditEvents(history, events), [history, events])
  if (!loading && !error && !auditEvents.length && !session.last_execution) return <EmptyState compact icon="terminal" title="Sem saída de execução" description="Os resultados e logs das operações do agente ficam disponíveis aqui quando existir uma execução."/>
  return <ExecutionHistorySurface session={session} events={auditEvents} loading={loading} error={error}/>
}
