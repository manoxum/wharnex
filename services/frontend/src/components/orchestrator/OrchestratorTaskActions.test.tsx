import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { emptyOrchestratorTaskCounts } from '../../lib/orchestratorApi'
import type { OrchestratorTask, OrchestratorTaskStatus, Session } from '../../types'
import { OrchestratorKanban } from './OrchestratorKanban'
import { OrchestratorTaskActions } from './OrchestratorTaskActions'

function task(status: OrchestratorTaskStatus, allowed_transitions: OrchestratorTaskStatus[] = []): OrchestratorTask {
  return {
    id: `task-${status.toLowerCase()}`, project_path: '/workspace/demo', title: `${status} task`, status, condition: 'none', priority: 'normal', parallelizable: false,
    allowed_transitions, was_completed: status === 'COMPLETE' || status === 'ARCHIVED', created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:00:00Z',
  }
}

afterEach(() => vi.restoreAllMocks())

it('opens without selecting or dragging the card and supports keyboard and outside dismissal', () => {
  const parentClick = vi.fn()
  const parentDrag = vi.fn()
  const parentKey = vi.fn()
  const onOpen = vi.fn()
  render(<div onClick={parentClick} onDragStart={parentDrag} onKeyDown={parentKey}><OrchestratorTaskActions task={task('PENDING', ['READY'])} onOpen={onOpen} onTransition={vi.fn()}/></div>)
  const trigger = screen.getByRole('button', { name: 'Ações de PENDING task' })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(parentKey).not.toHaveBeenCalled()
  fireEvent.click(trigger)
  expect(parentClick).not.toHaveBeenCalled()
  expect(screen.getByRole('menu', { name: 'Ações de PENDING task' })).not.toBeNull()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Abrir detalhe' }))
  fireEvent.dragStart(trigger)
  expect(parentDrag).not.toHaveBeenCalled()
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
})

it('renders only transitions supplied by the backend for pending, ready, review, complete and archived tasks', () => {
  const { rerender } = render(<OrchestratorTaskActions task={task('PENDING', ['READY', 'ARCHIVED'])} onOpen={vi.fn()} onTransition={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de PENDING task' }))
  expect(screen.getByRole('menuitem', { name: 'Mover para READY' })).not.toBeNull()
  expect(screen.getByRole('menuitem', { name: 'Arquivar' })).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ações de PENDING task' }))

  rerender(<OrchestratorTaskActions task={task('READY', ['PENDING', 'ARCHIVED'])} onOpen={vi.fn()} onTransition={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de READY task' }))
  expect(screen.getByRole('menuitem', { name: 'Mover para PENDING' })).not.toBeNull()
  expect(screen.queryByRole('menuitem', { name: 'Concluir' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ações de READY task' }))

  rerender(<OrchestratorTaskActions task={task('REVIEW', ['COMPLETE', 'ARCHIVED'])} onOpen={vi.fn()} onTransition={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de REVIEW task' }))
  expect(screen.getByRole('menuitem', { name: 'Concluir' })).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ações de REVIEW task' }))

  rerender(<OrchestratorTaskActions task={task('COMPLETE', ['ARCHIVED'])} onOpen={vi.fn()} onTransition={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de COMPLETE task' }))
  expect(screen.getByRole('menuitem', { name: 'Arquivar' })).not.toBeNull()
  expect(screen.queryByRole('menuitem', { name: /PENDING|READY|Reabrir/i })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ações de COMPLETE task' }))

  rerender(<OrchestratorTaskActions task={task('ARCHIVED', [])} onOpen={vi.fn()} onTransition={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de ARCHIVED task' }))
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Abrir detalhe'])
})

it('invokes the exact advertised transition and keeps the menu open when it fails', async () => {
  const onTransition = vi.fn<(status: OrchestratorTaskStatus) => Promise<void>>().mockResolvedValue(undefined)
  const { rerender } = render(<OrchestratorTaskActions task={task('COMPLETE', ['ARCHIVED'])} onOpen={vi.fn()} onTransition={onTransition}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de COMPLETE task' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Arquivar' }))
  await waitFor(() => expect(onTransition).toHaveBeenCalledWith('ARCHIVED'))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

  onTransition.mockRejectedValueOnce(new Error('rejected'))
  rerender(<OrchestratorTaskActions task={task('PENDING', ['READY'])} onOpen={vi.fn()} onTransition={onTransition}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de PENDING task' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Mover para READY' }))
  expect(await screen.findByRole('alert')).not.toBeNull()
  expect(screen.getByRole('menu')).not.toBeNull()
})

it('reconciles an archive across terminal pages and totals without duplicating unrelated tasks', async () => {
  const session = {
    id: 'ses-actions', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-28T00:00:00Z',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
  } satisfies Session
  const complete = task('COMPLETE', ['ARCHIVED'])
  const existingComplete = { ...task('COMPLETE', ['ARCHIVED']), id: 'existing-complete', title: 'Existing complete' }
  const existingArchived = { ...task('ARCHIVED'), id: 'existing-archived', title: 'Existing archived' }
  const counts = emptyOrchestratorTaskCounts()
  counts.COMPLETE = 2
  counts.ARCHIVED = 1
  vi.spyOn(api, 'transitionOrchestratorTask').mockResolvedValue({ ...complete, status: 'ARCHIVED', allowed_transitions: [], updated_at: '2026-09-28T00:01:00Z' })
  render(<OrchestratorKanban tasks={[complete]} taskCounts={counts} terminalPages={{ COMPLETE: { tasks: [complete, existingComplete], total: 2, has_more: false }, ARCHIVED: { tasks: [existingArchived], total: 1, has_more: false } }} searching={false} session={session} busy={false} onEffort={vi.fn()} onDrag={vi.fn()} onDrop={vi.fn()} onLoadMore={vi.fn()} onSelect={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Ações de COMPLETE task' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Arquivar' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Coluna COMPLETE, 1 tarefas' })).not.toBeNull())
  expect(screen.getByRole('region', { name: 'Coluna ARCHIVED, 2 tarefas' })).not.toBeNull()
  expect(screen.getAllByText('COMPLETE task')).toHaveLength(1)
  expect(screen.getAllByText('Existing complete')).toHaveLength(1)
  expect(screen.getAllByText('Existing archived')).toHaveLength(1)
})
