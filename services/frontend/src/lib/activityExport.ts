import type { PlanActivityItem } from './projectActivity'
import type { ExecutionSubtaskGroup } from './executionTimeline'
import { exportTraceMarkdownLines, type ExportTraceMetadata } from './exportMetadata'

export type PlanExportItem = Pick<PlanActivityItem, 'label' | 'timestamp' | 'plan'>

const MARKDOWN_FENCE = String.fromCharCode(96).repeat(3)

export function activityExportFilename(kind: 'plano' | 'subplano' | 'execucao' | 'subexecucao', id: string) {
  const clean = id.replace(/^(req_|plan_)/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'historico'
  return `${kind}-${clean}.md`
}

export function buildMainPlanExport(rootRequestId: string, plans: PlanExportItem[], metadata: ExportTraceMetadata) {
  const ordered = [...plans].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const lines = [
    '# Plano · Main Request',
    '',
    ...exportTraceMarkdownLines(metadata),
    `- Main Request: \`${rootRequestId}\``,
    `- Subplanos: ${ordered.length}`,
    '',
  ]
  ordered.forEach((item, index) => lines.push(...planSection(item, `Subplano ${String(index + 1).padStart(2, '0')}`)))
  return lines.join('\n').trimEnd() + '\n'
}

export function buildSubplanExport(item: PlanExportItem, sequence: number, rootRequestId: string, metadata: ExportTraceMetadata) {
  return [
    `# Subplano ${String(sequence).padStart(2, '0')}`,
    '',
    ...exportTraceMarkdownLines(metadata),
    `- Main Request: \`${rootRequestId}\``,
    '',
    ...planSection(item, ''),
  ].join('\n').trimEnd() + '\n'
}

export function buildMainExecutionExport(rootRequestId: string, updatedAt: string, groups: ExecutionSubtaskGroup[], metadata: ExportTraceMetadata) {
  const lines = [
    '# Execução · Main Request',
    '',
    ...exportTraceMarkdownLines(metadata),
    `- Main Request: \`${rootRequestId}\``,
    `- Atualizada em: ${updatedAt}`,
    `- Subexecuções: ${groups.length}`,
    '',
  ]
  groups.forEach((group, index) => lines.push(...executionSection(group, index + 1)))
  return lines.join('\n').trimEnd() + '\n'
}

export function buildSubexecutionExport(group: ExecutionSubtaskGroup, sequence: number, metadata: ExportTraceMetadata) {
  return [
    `# Subexecução ${String(sequence).padStart(2, '0')}`,
    '',
    ...exportTraceMarkdownLines(metadata),
    ...executionSection(group, sequence).slice(1),
  ].join('\n').trimEnd() + '\n'
}

export function downloadActivityExport(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function planSection(item: PlanExportItem, heading: string) {
  const plan = item.plan
  const lines = [
    heading ? `## ${heading} · ${item.label}` : `- Estado: ${item.label}`,
    '',
    `- Plano: \`${plan.plan_id}\``,
    `- Request: \`${plan.request_id}\``,
    `- Data: ${item.timestamp}`,
    `- Protocolo: ${plan.protocol}`,
    `- Estado: ${plan.status}`,
    `- Risco: ${plan.risk}`,
    `- Aprovação necessária: ${plan.requires_approval ? 'sim' : 'não'}`,
    '',
    `### ${plan.summary || 'Plano de execução'}`,
    '',
  ]
  if (plan.document?.trim()) lines.push(plan.document.trim(), '')
  lines.push('### Dados completos', '', `${MARKDOWN_FENCE}json`, JSON.stringify(plan, null, 2), MARKDOWN_FENCE, '')
  return lines
}

function executionSection(group: ExecutionSubtaskGroup, sequence: number) {
  const requestId = group.requestId || group.rootRequestId || '—'
  return [
    `## Subexecução ${String(sequence).padStart(2, '0')}`,
    '',
    `- Request: \`${requestId}\``,
    `- Main Request: \`${group.rootRequestId || requestId}\``,
    `- Tipo: ${group.iterationKind}`,
    `- Estado: ${group.overview}`,
    `- Atualizada em: ${group.updatedAt}`,
    `- Eventos: ${group.entries.length}`,
    '',
    '### Timeline normalizada',
    '',
    `${MARKDOWN_FENCE}json`,
    JSON.stringify(group.entries, null, 2),
    MARKDOWN_FENCE,
    '',
  ]
}
