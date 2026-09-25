import { request } from './api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8888'

export type OperationalLevel = 'trace' | 'debug' | 'info' | 'success' | 'warning' | 'error'
export type OperationalSource = 'backend' | 'desktop' | 'frontend'

export type OperationalRecord = {
  id: string
  occurred_at: string
  source: OperationalSource
  component: string
  level: OperationalLevel
  category: string
  event: string
  message?: string
  session_id?: string
  request_id?: string
  root_request_id?: string
  chat_id?: string
  task_id?: string
  plan_id?: string
  project_id?: string
  event_ref?: string
  trace_id?: string
  data?: Record<string, unknown>
}

export type CorrelationField = 'request_id' | 'chat_id' | 'task_id' | 'trace_id' | 'session_id'

export type OperationalLogFilter = {
  minLevel: OperationalLevel
  source: '' | OperationalSource
  period: OperationalPeriod
  search: string
  correlation?: { field: CorrelationField; value: string }
}

export const OPERATIONAL_PERIODS = { '15m': 15, '1h': 60, '24h': 24 * 60, '15d': 15 * 24 * 60 } as const
export type OperationalPeriod = keyof typeof OPERATIONAL_PERIODS

export const DEFAULT_OPERATIONAL_FILTER: OperationalLogFilter = { minLevel: 'info', source: '', period: '1h', search: '' }

// The level is always spelled out; color only supplements it.
export const LEVEL_PRESENTATION: Record<OperationalLevel, { label: string; tone: string }> = {
  trace: { label: 'Trace', tone: 'border-whx-border text-whx-faint' },
  debug: { label: 'Debug', tone: 'border-whx-border text-whx-faint' },
  info: { label: 'Info', tone: 'border-whx-border text-whx-soft' },
  success: { label: 'Sucesso', tone: 'border-whx-success/40 text-whx-success' },
  warning: { label: 'Aviso', tone: 'border-whx-warning/50 text-whx-warning' },
  error: { label: 'Erro', tone: 'border-whx-danger/50 text-whx-danger' },
}

export const CORRELATION_LABELS: Record<CorrelationField, string> = {
  request_id: 'Pedido', chat_id: 'Chat', task_id: 'Tarefa', trace_id: 'Trace', session_id: 'Sessão',
}

export function operationalLogQuery(filter: OperationalLogFilter, limit: number, now = Date.now()) {
  const params = new URLSearchParams({ min_level: filter.minLevel, limit: String(limit) })
  params.set('since', new Date(now - OPERATIONAL_PERIODS[filter.period] * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'))
  if (filter.source) params.set('source', filter.source)
  if (filter.search.trim()) params.set('q', filter.search.trim())
  if (filter.correlation?.value.trim()) params.set(filter.correlation.field, filter.correlation.value.trim())
  return params.toString()
}

export async function fetchOperationalLog(filter: OperationalLogFilter, limit = 300) {
  const result = await request<{ records: OperationalRecord[] }>(`/api/operational-log?${operationalLogQuery(filter, limit)}`)
  return result.records || []
}

export function correlationsOf(record: OperationalRecord): Array<{ field: CorrelationField; value: string }> {
  return (['request_id', 'chat_id', 'task_id', 'trace_id'] as CorrelationField[])
    .map((field) => ({ field, value: String(record[field] || '') }))
    .filter((entry) => entry.value)
}

export function levelCounts(records: OperationalRecord[]) {
  const counts: Partial<Record<OperationalLevel, number>> = {}
  for (const record of records) counts[record.level] = (counts[record.level] || 0) + 1
  return counts
}

// Downloads the filtered slice as the JSON dossier the self-evolution evidence
// panel can import for analysis.
export async function downloadOperationalDossier(filter: OperationalLogFilter) {
  const response = await fetch(`${API_URL}/api/operational-log/export?${operationalLogQuery(filter, 5000)}`)
  if (!response.ok) throw new Error(`Não foi possível exportar o diário (HTTP ${response.status}).`)
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'wharnex-diario.json'
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return filename
}
