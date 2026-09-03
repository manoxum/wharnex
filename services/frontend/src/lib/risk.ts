export function riskLabel(risk?: string) {
  if (risk === 'high') return 'Alto'
  if (risk === 'medium') return 'Médio'
  return 'Baixo'
}

export function stateLabel(state?: string) {
  const labels: Record<string, string> = {
    ready: 'Contexto pronto',
    planned: 'Plano pronto',
    workflow_planned: 'Passo local pronto',
    workflow_observed: 'Evidências recolhidas',
    workflow_pending: 'Aguardando ChatGPT',
    answered: 'Respondido',
    awaiting_clarification: 'Aguardando esclarecimento',
    investigated: 'Analisado',
    blocked: 'Bloqueado',
    repair_pending: 'Correção em curso',
    verified: 'Verificado',
    failed: 'Falhou',
    applied: 'Aplicado',
  }
  return labels[state || ''] || state || 'Inativo'
}
