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
    baseline_update_pending: 'A adaptar ao novo baseline',
	conflict_resolution_pending: 'Conflito em resolução dedicada',
    verified: 'Verificado',
    failed: 'Falhou',
    applied: 'Aplicado',
    reverted: 'Revertido',
  }
  return labels[state || ''] || state || 'Inativo'
}
