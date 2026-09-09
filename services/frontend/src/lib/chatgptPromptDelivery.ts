export type PromptDeliveryFailureKind = 'retry' | 'attention' | 'storage'

export function promptDeliveryFailureKind(message: string): PromptDeliveryFailureKind {
  const detail = String(message || '').toLowerCase()
  if (/xminiostoragefull|minimum free drive threshold|no space left|storage.*full|armazenamento.*cheio/.test(detail)) return 'storage'
  if (/composer|compositor|prontid|verifica|anti-rob|autentica|login|bloqueou o acesso|ação humana|external auth/.test(detail)) return 'attention'
  return 'retry'
}
