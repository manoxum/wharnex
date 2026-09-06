export type PromptDeliveryFailureKind = 'retry' | 'attention'

export function promptDeliveryFailureKind(message: string): PromptDeliveryFailureKind {
  const detail = String(message || '').toLowerCase()
  if (/composer|compositor|prontid|verifica|anti-rob|autentica|login|bloqueou o acesso|ação humana|external auth/.test(detail)) return 'attention'
  return 'retry'
}
