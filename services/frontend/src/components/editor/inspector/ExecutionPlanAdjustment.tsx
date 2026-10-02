import type { Session } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'

function adjustmentUnavailableReason(session: Session): string | undefined {
  const plan = session.plan
  if (!plan) return 'Não existe um plano pendente para ajustar.'
  if (session.state === 'failed' || (session.last_execution?.plan_id === plan.plan_id && !session.last_execution.success)) {
    return 'Este plano já teve uma tentativa de execução. Use Corrigir com GPT na mensagem de falha do chat.'
  }
  if (session.state !== 'planned' || !plan.request_id.trim()) {
    return 'Apenas um plano pendente, ainda por executar, pode ser ajustado.'
  }
  if (session.interrupted_execution || session.last_execution?.plan_id === plan.plan_id || session.pending_host_changes?.some((change) => change.plan.plan_id === plan.plan_id)
    || session.last_applied_changes?.some((change) => change.plan.plan_id === plan.plan_id)) {
    return 'Este plano já iniciou a execução e não pode ser ajustado como uma proposta pendente.'
  }
  return undefined
}

// Keep the shared secondary-button cascade: migrating it here would also
// restyle unrelated plan controls (FRONTEND_STYLING §3 scoped exception).
export function ExecutionPlanAdjustment({ session, busy, onAdjust }: {
  session: Session
  busy: boolean
  onAdjust?: () => void
}) {
  const reason = adjustmentUnavailableReason(session)
  return <button type="button" className="secondary-button" disabled={busy || Boolean(reason)} title={reason} onClick={onAdjust}>
    <Icon name="edit" size={13}/> Ajustar
  </button>
}
