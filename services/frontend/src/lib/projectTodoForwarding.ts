import type { ProjectTodo } from '../types'

type StoredAttachmentContent = {
  name: string
  mime?: string
  contentBase64: string
}

export function storedAttachmentFile(stored: StoredAttachmentContent, fallbackMime = 'application/octet-stream') {
  const binary = atob(stored.contentBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], stored.name, { type: stored.mime || fallbackMime })
}

function safeTodoSegment(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'todo'
}

export function projectTodoPrePlanFilename(todo: ProjectTodo) {
  return `wharnex-todo-${safeTodoSegment(todo.id)}-pre-analysis.md`
}

export function projectTodoPrePlanAttachment(todo: ProjectTodo) {
  const steps = (todo.pre_plan || []).map((step) => step.trim()).filter(Boolean)
  const lines = [
    '# Pré-análise do TODO',
    '',
    'Documento sintético gerado pelo Wharnex para transportar a análise completa associada a uma referência @todo.',
    '',
    '## Identidade e classificação',
    '',
    `- ID: ${todo.id}`,
    `- Estado do TODO: ${todo.status}`,
    `- Estado da classificação: ${todo.classification_status}`,
    `- Tipo: ${todo.kind || 'não classificado'}`,
    `- Urgência: ${todo.urgency || 'não classificada'}`,
    '',
    '## TODO original',
    '',
    todo.body.trim(),
  ]
  const description = todo.description?.trim()
  lines.push('', '## Contexto do Worker', '', description || '_Ainda não disponível._')
  lines.push('', '## Pré-plano', '')
  if (steps.length) lines.push(...steps.map((step, index) => `${index + 1}. ${step}`))
  else lines.push('_Ainda não disponível._')
  if (todo.classification_error?.trim()) lines.push('', '## Erro de classificação', '', todo.classification_error.trim())
  lines.push('', '## Ficheiros do projeto referenciados', '')
  if (todo.project_files?.length) lines.push(...todo.project_files.map((path) => `- ${path}`))
  else lines.push('_Nenhum._')
  lines.push('', '## Artefactos anexados ao TODO', '')
  if (todo.attachments?.length) lines.push(...todo.attachments.map((attachment) => `- ${attachment.name} (${attachment.mime || 'application/octet-stream'}, ${attachment.size} bytes)`))
  else lines.push('_Nenhum._')
  lines.push('')

  return new File([lines.join('\n')], projectTodoPrePlanFilename(todo), { type: 'text/markdown' })
}

export function withProjectTodoPrePlan(todo: ProjectTodo, attachments: File[]) {
  return [...attachments, projectTodoPrePlanAttachment(todo)]
}
