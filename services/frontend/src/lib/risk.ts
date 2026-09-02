export function riskLabel(risk?: string) {
  if (risk === 'high') return 'Alto'
  if (risk === 'medium') return 'Médio'
  return 'Baixo'
}

export function stateLabel(state?: string) {
  const labels: Record<string, string> = {
    ready: 'Contexto pronto',
    planned: 'Plano pronto',
    verified: 'Verificado',
    failed: 'Falhou',
    applied: 'Aplicado',
  }
  return labels[state || ''] || state || 'Inativo'
}
