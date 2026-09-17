import type { ProjectTodo } from '../types'

export const PROJECT_TODO_PREPLAN_FILENAME = 'wharnex-todo-pre-plan.md'

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

export function projectTodoPrePlanAttachment(todo: ProjectTodo) {
  const steps = (todo.pre_plan || []).map((step) => step.trim()).filter(Boolean)
  if (!steps.length) return undefined

  const lines = [
    '# Pré-plano do TODO',
    '',
    'Pré-plano preparado pelo Worker do Wharnex para acompanhar este TODO.',
    '',
    '## TODO original',
    '',
    todo.body.trim(),
  ]
  const description = todo.description?.trim()
  if (description) lines.push('', '## Contexto do Worker', '', description)
  lines.push('', '## Pré-plano', '', ...steps.map((step, index) => `${index + 1}. ${step}`), '')

  return new File([lines.join('\n')], PROJECT_TODO_PREPLAN_FILENAME, { type: 'text/markdown' })
}

export function withProjectTodoPrePlan(todo: ProjectTodo, attachments: File[]) {
  const prePlan = projectTodoPrePlanAttachment(todo)
  return prePlan ? [...attachments, prePlan] : attachments
}
