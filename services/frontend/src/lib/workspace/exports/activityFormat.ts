export function shortRequestId(value: string) {
  return value ? value.replace(/^req_/, '').slice(0, 24) : 'sessão'
}

export function shortPlanId(value: string) {
  return value ? value.replace(/^plan_/, '').slice(0, 24) : 'plano'
}

export function formatActivityDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}

export function formatActivityDuration(value: number) {
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
  const minutes = Math.floor(value / 60_000)
  return `${minutes}m ${Math.round((value % 60_000) / 1000)}s`
}
