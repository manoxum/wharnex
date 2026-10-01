import { describe, expect, it } from 'vitest'
import type { ProjectTodo } from '../../../types'
import { projectTodoPrePlanAttachment, projectTodoPrePlanFilename, storedAttachmentFile, withProjectTodoPrePlan } from './projectTodoForwarding'

const todo = {
  id: 'todo-1', project_path: '/tmp/demo', body: 'Melhorar a pesquisa', status: 'open', classification_status: 'classified',
  description: 'Preservar o fluxo atual enquanto a pesquisa é otimizada.',
  pre_plan: ['Medir o fluxo atual.', ' Ajustar a implementação. ', 'Cobrir o comportamento com testes.'],
  kind: 'improvement', urgency: 'urgent', project_files: ['src/search.ts'],
  attachments: [{ name: 'evidence.txt', size: 8, mime: 'text/plain', storage_ref: 'todo/evidence.txt' }],
  created_at: '2026-09-17T10:00:00Z', updated_at: '2026-09-17T10:01:00Z',
} satisfies ProjectTodo

function readFileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error(`Não foi possível ler ${file.name}.`))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  })
}

describe('project TODO forwarding', () => {
  it('turns the worker pre-plan into a Markdown attachment', async () => {
    const attachment = projectTodoPrePlanAttachment(todo)
    expect(attachment.name).toBe(projectTodoPrePlanFilename(todo))
    expect(attachment.type).toBe('text/markdown')
    expect(attachment.size).toBeGreaterThan(todo.body.length)
    const markdown = await readFileText(attachment)
    expect(markdown).toContain('Tipo: improvement')
    expect(markdown).toContain('Urgência: urgent')
    expect(markdown).toContain('Preservar o fluxo atual')
    expect(markdown).toContain('1. Medir o fluxo atual.')
    expect(markdown).toContain('src/search.ts')
    expect(markdown).toContain('evidence.txt')
  })

  it('appends the pre-plan without replacing the original TODO attachments', () => {
    const original = new File(['evidence'], 'evidence.txt', { type: 'text/plain' })
    const forwarded = withProjectTodoPrePlan(todo, [original])
    expect(forwarded.map((file) => file.name)).toEqual(['evidence.txt', projectTodoPrePlanFilename(todo)])
  })

  it('still emits a transport document before classification finishes', async () => {
    const pending = { ...todo, classification_status: 'queued' as const, description: undefined, pre_plan: [] }
    const attachment = projectTodoPrePlanAttachment(pending)
    const markdown = await readFileText(attachment)
    expect(markdown).toContain('Estado da classificação: queued')
    expect(markdown).toContain('_Ainda não disponível._')
  })

  it('recreates a stored TODO attachment as a browser File', () => {
    const file = storedAttachmentFile({ name: 'evidence.txt', mime: 'text/plain', contentBase64: btoa('evidence') })
    expect(file.name).toBe('evidence.txt')
    expect(file.type).toBe('text/plain')
    expect(file.size).toBe('evidence'.length)
  })
})
