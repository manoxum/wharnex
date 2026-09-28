import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { OrchestratorTask, Session } from '../types'
import type { ComposerDirective } from '../lib/composerDirectives'
import { ComposerReferenceThumbnail } from './ComposerReferenceThumbnail'

const session = {
  id: 'ses-reference', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-28T00:00:00Z',
  context: { id: 'ctx-reference', manifest: { id: 'ctx-reference', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

const task = {
  id: 'task-done', project_path: '/workspace/demo', plan_id: 'plan-1', title: 'Preparar contrato', description: 'Contrato concluído para reutilização.', acceptance_criteria: ['Mantém o resultado anterior'],
  status: 'COMPLETE', condition: 'none', priority: 'normal', parallelizable: false, depends_on: ['task-base'], was_completed: true,
  created_at: '2026-09-27T23:00:00Z', updated_at: '2026-09-28T00:00:00Z',
} satisfies OrchestratorTask

const directive = { kind: 'task', value: task.id, project: '', path: task.id, start: 0, end: 25 } satisfies ComposerDirective

it('renders a completed @task as a coherent read-only reference preview', () => {
  render(<ComposerReferenceThumbnail session={session} directive={directive} attachments={[]} chatFiles={[]} libraryArtifacts={[]} projectTodos={[]} orchestratorTasks={[task]} onRemove={vi.fn()}/>)
  expect(screen.getByText(task.title)).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: `Visualizar referência @task ${task.title}` }))
  const dialog = screen.getByRole('dialog', { name: `Visualizar referência @task ${task.title}` })
  expect(within(dialog).getByText('Mantém o resultado anterior')).not.toBeNull()
  expect(within(dialog).getByText('task-base')).not.toBeNull()
  expect(within(dialog).queryByRole('button', { name: /Editar/i })).toBeNull()
})
