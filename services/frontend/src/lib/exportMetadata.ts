import type { ChatItem, Session } from '../types'
import { api } from './api'

export type ExportKind = 'chat' | 'plan' | 'subplan' | 'execution' | 'subexecution'

export type ExportTraceMetadata = {
  schema: 'wharnex.export-metadata/v1'
  created_at: string
  export_kind: ExportKind
  wharnex_version: string
  project_version: string
  project_path: string
  session_id: string
  chat_id?: string
  root_request_id?: string
  request_id?: string
  plan_id?: string
  context_id?: string
  context_sha256?: string
  wharnex_instance_id?: string
}

export type ExportTraceContext = {
  kind: ExportKind
  rootRequestId?: string
  requestId?: string
  planId?: string
}

export async function resolveExportTraceMetadata(session: Session, context: ExportTraceContext): Promise<ExportTraceMetadata> {
  const [configResult, versionResult] = await Promise.allSettled([
    api.config(),
    api.readFile(session.id, 'VERSION'),
  ])
  const requestId = context.requestId?.trim() || session.last_request_id?.trim() || ''
  const rootRequestId = context.rootRequestId?.trim()
    || session.request_lineages?.[requestId]?.root_request_id?.trim()
    || requestId
  const wharnexVersion = configResult.status === 'fulfilled' ? configResult.value.version?.trim() || '' : ''
  const projectVersion = versionResult.status === 'fulfilled' ? versionResult.value.content.trim() : ''
  return {
    schema: 'wharnex.export-metadata/v1',
    created_at: new Date().toISOString(),
    export_kind: context.kind,
    wharnex_version: wharnexVersion || 'indisponível',
    project_version: projectVersion || 'indisponível',
    project_path: session.project_path,
    session_id: session.id,
    ...(session.chat_id ? { chat_id: session.chat_id } : {}),
    ...(rootRequestId ? { root_request_id: rootRequestId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(context.planId?.trim() ? { plan_id: context.planId.trim() } : {}),
    ...(session.context?.id ? { context_id: session.context.id } : {}),
    ...(session.context?.workspace_sha256 ? { context_sha256: session.context.workspace_sha256 } : {}),
    ...(session.wharnex_instance_id ? { wharnex_instance_id: session.wharnex_instance_id } : {}),
  }
}

export function exportTraceMarkdownLines(metadata: ExportTraceMetadata) {
  return [
    '## Metadados de rastreio',
    '',
    `- Schema de metadados: ${metadata.schema}`,
    `- Data de criação: ${metadata.created_at}`,
    `- Versão do Wharnex: ${metadata.wharnex_version}`,
    `- Versão do projeto: ${metadata.project_version}`,
    `- Tipo de exportação: ${metadata.export_kind}`,
    `- Projeto: \`${metadata.project_path}\``,
    `- Sessão: \`${metadata.session_id}\``,
    ...(metadata.chat_id ? [`- Chat: \`${metadata.chat_id}\``] : []),
    ...(metadata.root_request_id ? [`- Main Request: \`${metadata.root_request_id}\``] : []),
    ...(metadata.request_id ? [`- Request: \`${metadata.request_id}\``] : []),
    ...(metadata.plan_id ? [`- Plano: \`${metadata.plan_id}\``] : []),
    ...(metadata.context_id ? [`- Contexto: \`${metadata.context_id}\``] : []),
    ...(metadata.context_sha256 ? [`- SHA-256 do contexto: \`${metadata.context_sha256}\``] : []),
    ...(metadata.wharnex_instance_id ? [`- Instância Wharnex: \`${metadata.wharnex_instance_id}\``] : []),
    '',
  ]
}

export function exportTraceChatItem(metadata: ExportTraceMetadata): ChatItem {
  return {
    id: `export-metadata-${metadata.created_at}`,
    role: 'harness',
    source: 'wharness',
    presentation: 'notice',
    createdAt: metadata.created_at,
    meta: 'Metadados de rastreio da exportação',
    text: exportTraceMarkdownLines(metadata).join('\n').trimEnd(),
  }
}
