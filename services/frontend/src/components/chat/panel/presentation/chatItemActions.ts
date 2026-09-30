import type { ChatItem } from '../../../../types'
import { promptDialog } from '../../../../lib/desktop/bridge/appDialog'
import { promptGPTRepairDetail } from '../../../../lib/execution/recovery/plannerRecovery'

export async function requestPlanCorrection(item: ChatItem, onCorrectPlan?: (item: ChatItem, guidance: string) => Promise<void>) {
  if (!onCorrectPlan) return
  const guidance = await promptDialog({
    title: 'Solicitar correção do plano',
    message: 'Indique o que deve ser corrigido. O Wharnex manterá a mesma Main Request e pedirá apenas uma nova proposta de plano, sem executar alterações.',
    inputLabel: 'Correção pretendida',
    placeholder: 'Ex.: dividir a migração em duas fases e incluir rollback',
    confirmLabel: 'Solicitar correção',
    validate: (value) => value.trim() ? undefined : 'Descreva a correção pretendida.',
  })
  if (guidance === undefined) return
  await onCorrectPlan(item, guidance.trim())
}

export async function requestGPTRepair(onRepairWithGPT: (detail: string) => Promise<void>, requiresOperatorGuidance: boolean) {
  const detail = await promptGPTRepairDetail(requiresOperatorGuidance)
  if (detail === undefined) return
  await onRepairWithGPT(detail)
}
