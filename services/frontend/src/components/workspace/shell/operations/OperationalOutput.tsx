import { OutputBrowser } from './output'
import { useMemo } from 'react'
import type { HarnessEvent, Session } from '../../../../types'
import { projectExecutionEvidence } from '../../../../lib/execution/evidence'
import { mergeAuditEvents } from '../../../../lib/project/context/projectActivity'
import { useExecutionHistory } from '../../../execution/history/useExecutionHistory'

export function OperationalOutput({ session, events, active }: { session: Session; events: HarnessEvent[]; active: boolean }) {
  const { events: history, loading, error } = useExecutionHistory(session, active ? 'terminal' : 'inactive')
  const auditEvents = useMemo(() => projectExecutionEvidence(mergeAuditEvents(history, events), session), [history, events, session])
  return <OutputBrowser events={auditEvents} loading={loading} error={error}/>
}
