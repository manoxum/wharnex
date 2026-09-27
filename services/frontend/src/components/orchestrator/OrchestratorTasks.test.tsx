import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import type { OrchestratorOverview, OrchestratorTask, Session } from '../../types'
import { OrchestratorTasks } from './OrchestratorTasks'

const session = {
  id: 'ses-orchestrator', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected',
  automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-27T18:00:00Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

function task(id: string, status: OrchestratorTask['status']): OrchestratorTask {
  return {
    id, project_path: '/workspace/demo', title: id, status, condition: status === 'WAITING' ? 'dependency' : 'none',
    priority: 'normal', parallelizable: false, created_at: '2026-09-27T18:00:00Z', updated_at: '2026-09-27T18:00:00Z',
  }
}

afterEach(() => vi.restoreAllMocks())

it('releases PENDING explicitly and shows READY as waiting for a Worker', async () => {
  const pending = task('First', 'PENDING')
  const waiting = task('Second', 'WAITING')
  const ready = task('Third', 'READY')
  const overview: OrchestratorOverview = { plans: [], tasks: [pending, waiting, ready], planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 }
  const transitioned = vi.spyOn(api, 'transitionOrchestratorTask').mockResolvedValue({ ...pending, status: 'READY' })
  vi.spyOn(api, 'orchestratorTaskRuns').mockResolvedValue({ runs: [] })
  const selected = vi.fn()
  const props = {
    session, overview, busy: false, onSelectedTask: selected,
    onRun: <T,>(action: () => Promise<T>, after?: (value: T) => void) => action().then((value) => { after?.(value); return value }),
  }
  const view = render(<OrchestratorTasks {...props} selectedTask={pending} />)
  expect(screen.getByText('Espera')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar para READY' }))
  await waitFor(() => expect(transitioned).toHaveBeenCalledWith(session.id, pending.id, 'READY'))
  view.rerender(<OrchestratorTasks {...props} selectedTask={ready} />)
  expect(screen.getByText('A aguardar um Worker livre')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Iniciar no Agent' })).toBeNull()
})

it('hides archived cards in Kanban and offers a failed task retry with effort control', async () => {
  const failed = { ...task('Failed', 'FAILED'), condition: 'failed_run' as const }
  const archived = task('Archived', 'ARCHIVED')
  const overview: OrchestratorOverview = { plans: [], tasks: [failed, archived], planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 }
  const retry = vi.spyOn(api, 'retryOrchestratorTask').mockResolvedValue({ ...failed, status: 'READY' })
  const setEffort = vi.spyOn(api, 'setOrchestratorTaskEffort').mockResolvedValue({ ...failed, reasoning_effort: 'medium' })
  vi.spyOn(api, 'orchestratorTaskRuns').mockResolvedValue({ runs: [] })
  render(<OrchestratorTasks session={session} overview={overview} selectedTask={failed} busy={false} onSelectedTask={vi.fn()} onRun={async <T,>(action: () => Promise<T>) => action()}/>)
  expect(screen.queryByText('Archived')).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: 'Nível de raciocínio da tarefa' }), { target: { value: 'medium' } })
  await waitFor(() => expect(setEffort).toHaveBeenCalledWith(session.id, failed.id, 'medium'))
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar sem contexto' }))
  await waitFor(() => expect(retry).toHaveBeenCalledWith(session.id, failed.id, { guidance: '', project_files: [], attachment_cache_key: undefined, attachments: undefined }))
})
