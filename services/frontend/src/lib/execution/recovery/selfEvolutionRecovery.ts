import { request } from '../../transport/http/api'
import { confirmDialog } from '../../desktop/bridge/appDialog'

export type SelfEvolutionBlock = {
  phase: string
  transaction: string
  plan_id?: string
  session_id?: string
  detail?: string
  remedy?: string
  releasable: boolean
}

type RecoveryDependencies = {
  read: () => Promise<{ blocked: boolean; block?: SelfEvolutionBlock }>
  release: (transaction: string) => Promise<unknown>
  confirm: typeof confirmDialog
}

const defaults: RecoveryDependencies = {
  read: () => request('/api/self-evolution/block'),
  release: (transaction) => request('/api/self-evolution/block/release', {
    method: 'POST', body: JSON.stringify({ transaction }),
  }),
  confirm: confirmDialog,
}

// A busy transaction may be a short-lived coordination race or a durable
// fail-closed hold. Only the latter needs operator acknowledgement; the exact
// transaction returned by the backend is sent back so this can never become a
// blanket lock reset.
export async function clearSelfEvolutionBlockForRetry(overrides: Partial<RecoveryDependencies> = {}): Promise<boolean> {
  const dependencies = { ...defaults, ...overrides }
  const status = await dependencies.read()
  if (!status.blocked || !status.block) return true

  const block = status.block
  const detail = [
    `Transação: ${block.transaction}`,
    `Fase: ${block.phase}`,
    block.plan_id ? `Plano: ${block.plan_id}` : '',
    block.detail || '',
    block.remedy || '',
    '',
    'Confirme apenas depois de verificar que a recuperação indicada foi concluída. A candidata deste chat continuará preservada.',
  ].filter(Boolean).join('\n')
  const confirmed = await dependencies.confirm({
    title: 'Libertar bloqueio de autoevolução?',
    message: detail,
    tone: 'danger',
    confirmLabel: 'Libertar e repetir',
    cancelLabel: 'Manter bloqueado',
  })
  if (!confirmed) return false
  await dependencies.release(block.transaction)
  return true
}
