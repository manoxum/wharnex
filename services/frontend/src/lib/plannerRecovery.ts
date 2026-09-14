import type { Session } from '../types'
import { promptDialog } from './appDialog'

export const PLANNER_GUIDANCE_REQUIRED = 'planner_guidance_required'

// Mirrors the backend's plannerDeclaredNonRetryable gate: once the planner has
// set retryable=false on the request that actually failed, every bare retry is
// refused server-side. Detecting that here keeps the recovery surface honest —
// the guidance-carrying repair asks for that guidance up front, and the bare
// resume is withdrawn instead of being offered as an action that can only ever
// come back as the planner's refusal.
export function plannerDeclaredNonRetryable(session?: Session): boolean {
  if (session?.failure_kind === PLANNER_GUIDANCE_REQUIRED) return true
  const turn = session?.last_turn
  if (!turn || !turn.outcome) return false
  if (turn.request_id !== session?.last_request_id) return false
  if (turn.outcome.status === 'completed' || turn.outcome.retryable) return false
  return true
}

// Every surface that offers the GPT repair opens this one dialog, so the
// guidance requirement cannot hold on one entry point and be missing on another.
export async function promptGPTRepairDetail(requiresOperatorGuidance: boolean) {
  const detail = await promptDialog({
    title: requiresOperatorGuidance ? 'Fornecer nova evidência ao GPT' : 'Corrigir erro com GPT',
    message: requiresOperatorGuidance
      ? 'O GPT já classificou esta falha como não repetível sem intervenção. Descreva a evidência ou orientação que mudou desde a última tentativa para justificar uma nova tentativa.'
      : 'O Wharnex enviará o erro, os resultados da execução e o contexto atual. Pode acrescentar um detalhe para orientar a correção ou deixar em branco.',
    inputLabel: requiresOperatorGuidance ? 'Evidência ou orientação necessária' : 'Detalhe opcional',
    placeholder: requiresOperatorGuidance ? 'Ex.: cole a primeira linha ERROR/failed to solve e o trecho relevante do build' : 'Ex.: verifique também o comportamento no Windows',
    confirmLabel: requiresOperatorGuidance ? 'Enviar nova evidência' : 'Enviar para correção',
    tone: 'warning',
    multiline: requiresOperatorGuidance,
    validate: requiresOperatorGuidance
      ? (value) => value.trim() ? undefined : 'Acrescente a evidência ou orientação que mudou desde a última tentativa.'
      : undefined,
  })
  return detail === undefined ? undefined : detail.trim()
}
