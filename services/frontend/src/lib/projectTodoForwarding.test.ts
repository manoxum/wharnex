import { describe, expect, it } from 'vitest'
import type { ProjectTodo } from '../types'
import { PROJECT_TODO_PREPLAN_FILENAME, projectTodoPrePlanAttachment, storedAttachmentFile, withProjectTodoPrePlan } from './projectTodoForwarding'

const todo = {
  id: 'todo-1', project_path: '/tmp/demo', body: 'Melhorar a pesquisa', status: 'open', classification_status: 'classified',
  description: 'Preservar o fluxo atual enquanto a pesquisa é otimizada.',
  pre_plan: ['Medir o fluxo atual.', ' Ajustar a implementação. ', 'Cobrir o comportamento com testes.'],
  created_at: '2026-09-17T10:00:00Z', updated_at: '2026-09-17T10:01:00Z',
} satisfies ProjectTodo

describe('project TODO forwarding', () => {
  it('turns the worker pre-plan into a Markdown attachment', () => {
    const attachment = projectTodoPrePlanAttachment(todo)
    expect(attachment?.name).toBe(PROJECT_TODO_PREPLAN_FILENAME)
    expect(attachment?.type).toBe('text/markdown')
    expect(attachment?.size).toBeGreaterThan(todo.body.length)
  })

  it('appends the pre-plan without replacing the original TODO attachments', () => {
    const original = new File(['evidence'], 'evidence.txt', { type: 'text/plain' })
    const forwarded = withProjectTodoPrePlan(todo, [original])
    expect(forwarded.map((file) => file.name)).toEqual(['evidence.txt', PROJECT_TODO_PREPLAN_FILENAME])
  })

  it('recreates a stored TODO attachment as a browser File', () => {
    const file = storedAttachmentFile({ name: 'evidence.txt', mime: 'text/plain', contentBase64: btoa('evidence') })
    expect(file.name).toBe('evidence.txt')
    expect(file.type).toBe('text/plain')
    expect(file.size).toBe('evidence'.length)
  })
})
