import type { Session } from '../../../types'

export type HostApplyAttention = { title: string; detail: string }

// hostApplyAttention words the attention card for a failure that kept its
// verified candidate and is cleared by repeating the host Apply. It returns
// undefined for every other failure kind.
export function hostApplyAttention(session: Session): HostApplyAttention | undefined {
  switch (session.failure_kind) {
    case 'self_evolution_transaction_metadata_mismatch':
      return { title: 'Aplicação ao host pronta para repetir', detail: 'A candidata continua verificada; o estado transacional local será validado e reparado com segurança antes de repetir a integração.' }
    case 'self_evolution_transaction_busy':
      return { title: 'Aplicação ao host bloqueada', detail: session.last_repair_error || 'A candidata continua verificada; uma transação local impede temporariamente a integração.' }
    case 'host_integration_race':
      return { title: 'Aplicação ao host pronta para repetir', detail: 'A candidata continua verificada; uma disputa local temporária impediu a integração anterior.' }
    case 'stale_host_baseline':
      return { title: 'Candidata precisa de nova validação', detail: 'O host mudou desde a verificação. Reveja a candidata retida e tente a integração novamente.' }
    case 'host_working_state_blocked':
      // The backend's message already names the exact paths and the single
      // action that clears it, so it is shown verbatim.
      return { title: 'Worktree do host precisa de resolução', detail: session.last_repair_error || 'Resolva o estado não commitado do projeto no host e repita a aplicação.' }
    case 'integration_action_required':
      // The planner proved only Wharnex's integration layer can move this
      // request. The engine retries by itself in automatic mode; the card is
      // the manual path and says no new evidence is being asked for.
      return { title: 'Integração a reconciliar pelo Wharnex', detail: 'O GPT indicou que o bloqueio está no estado de integração, não no código. O Wharnex reaplica a candidata quando o host a aceitar ou reconstrói o conflito; também pode repetir a aplicação agora.' }
    default:
      return undefined
  }
}
