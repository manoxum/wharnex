import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { emptyOrchestratorTaskCounts } from '../../lib/orchestratorApi'
import type { OrchestratorOverview, OrchestratorTask, OrchestratorTerminalTaskPages, Session } from '../../types'
import { OrchestratorTasks } from './OrchestratorTasks'

const session = {
  id: 'ses-orchestrator', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-27T18:00:00Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

function task(id: string, status: OrchestratorTask['status']): OrchestratorTask {
  return { id, project_path: '/workspace/demo', title: id, status, condition: status === 'WAITING' ? 'dependency' : 'none', priority: 'normal', parallelizable: false, created_at: '2026-09-27T18:00:00Z', updated_at: '2026-09-27T18:00:00Z' }
}

function overview(tasks: OrchestratorTask[], counts = emptyOrchestratorTaskCounts()): OrchestratorOverview {
  tasks.forEach((item) => { if (!counts[item.status]) counts[item.status] += 1 })
  return { plans: [], tasks, task_counts: counts, planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 }
}

const run = <T,>(action: () => Promise<T>, after?: (value: T) => void) => action().then((value) => { after?.(value); return value })
afterEach(() => vi.restoreAllMocks())

it('releases PENDING explicitly and shows READY as waiting for a Worker', async () => {
  const pending = task('First', 'PENDING')
  const ready = task('Third', 'READY')
  const transitioned = vi.spyOn(api, 'transitionOrchestratorTask').mockResolvedValue({ ...pending, status: 'READY' })
  vi.spyOn(api, 'orchestratorTaskRuns').mockResolvedValue({ runs: [] })
  const props = { session, overview: overview([pending, task('Second', 'WAITING'), ready]), busy: false, onSelectedTask: vi.fn(), onRun: run }
  const view = render(<OrchestratorTasks {...props} selectedTask={pending} />)
  expect(screen.getByText('Espera')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar para READY' }))
  await waitFor(() => expect(transitioned).toHaveBeenCalledWith(session.id, pending.id, 'READY'))
  view.rerender(<OrchestratorTasks {...props} selectedTask={ready} />)
  expect(screen.getByText('A aguardar um Worker livre')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Iniciar no Agent' })).toBeNull()
})

it('offers a failed task retry with effort control', async () => {
  const failed = { ...task('Failed', 'FAILED'), condition: 'failed_run' as const }
  const retry = vi.spyOn(api, 'retryOrchestratorTask').mockResolvedValue({ ...failed, status: 'READY' })
  const setEffort = vi.spyOn(api, 'setOrchestratorTaskEffort').mockResolvedValue({ ...failed, reasoning_effort: 'medium' })
  vi.spyOn(api, 'orchestratorTaskRuns').mockResolvedValue({ runs: [] })
  render(<OrchestratorTasks session={session} overview={overview([failed])} selectedTask={failed} busy={false} onSelectedTask={vi.fn()} onRun={run}/>)
  fireEvent.change(screen.getByRole('combobox', { name: 'Nível de raciocínio da tarefa' }), { target: { value: 'medium' } })
  await waitFor(() => expect(setEffort).toHaveBeenCalledWith(session.id, failed.id, 'medium'))
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar sem contexto' }))
  await waitFor(() => expect(retry).toHaveBeenCalledWith(session.id, failed.id, { guidance: '', project_files: [], attachment_cache_key: undefined, attachments: undefined }))
})

it('changes effort on a Kanban card without opening the task drawer', async () => {
  const ready = task('Parallel change', 'READY')
  const selected = vi.fn()
  const setEffort = vi.spyOn(api, 'setOrchestratorTaskEffortLevel').mockResolvedValue({ ...ready, effort_level: 'ultra' })
  render(<OrchestratorTasks session={session} overview={overview([ready])} busy={false} onSelectedTask={selected} onRun={run}/>)
  fireEvent.change(screen.getByRole('combobox', { name: 'Esforço de Parallel change' }), { target: { value: 'ultra' } })
  await waitFor(() => expect(setEffort).toHaveBeenCalledWith(session.id, ready.id, 'ultra'))
  expect(selected).not.toHaveBeenCalled()
})

it('offers the bounded composer effort levels on a card, never Loop', () => {
  const ready = task('Bounded', 'READY')
  render(<OrchestratorTasks session={{ ...session, effort_level: 'loop' }} overview={overview([ready])} busy={false} onSelectedTask={vi.fn()} onRun={run}/>)
  const select = screen.getByRole('combobox', { name: 'Esforço de Bounded' }) as HTMLSelectElement
  expect([...select.options].map((option) => option.value)).toEqual(['low', 'medium', 'high', 'extra_high', 'max', 'ultra'])
  expect(select.value).toBe('ultra')
})

it('keeps terminal totals from the overview while rendering only loaded page cards', () => {
  const counts = emptyOrchestratorTaskCounts(); counts.COMPLETE = 80; counts.ARCHIVED = 12
  const pages = {
    COMPLETE: { tasks: [task('Complete loaded', 'COMPLETE')], total: 80, has_more: true, next_cursor: 'complete-next' },
    ARCHIVED: { tasks: [task('Archived loaded', 'ARCHIVED')], total: 12, has_more: false },
  } satisfies OrchestratorTerminalTaskPages
  render(<OrchestratorTasks session={session} overview={overview([], counts)} terminalPages={pages} busy={false} onSelectedTask={vi.fn()} onRun={run}/>)
  expect(screen.getByRole('region', { name: 'Coluna COMPLETE, 80 tarefas' })).not.toBeNull()
  expect(screen.getByRole('region', { name: 'Coluna ARCHIVED, 12 tarefas' })).not.toBeNull()
  expect(screen.getByText('Complete loaded')).not.toBeNull()
  expect(screen.getByText('Archived loaded')).not.toBeNull()
})

it('searches terminal tasks through the paginated backend loader and appends the next page', async () => {
  const initial = { COMPLETE: { tasks: [task('Old complete', 'COMPLETE')], total: 40, has_more: true, next_cursor: 'old' } } satisfies OrchestratorTerminalTaskPages
  const needle1 = task('Needle one', 'COMPLETE')
  const needle2 = task('Needle two', 'COMPLETE')
  const loader = vi.fn(async (status: 'COMPLETE' | 'ARCHIVED', query?: { q?: string; cursor?: string }) => {
    if (status === 'ARCHIVED') return { tasks: [], total: 0, has_more: false }
    if (query?.cursor === 'needle-next') return { tasks: [needle2], total: 2, has_more: false }
    return { tasks: [needle1], total: 2, has_more: true, next_cursor: 'needle-next' }
  })
  render(<OrchestratorTasks session={session} overview={overview([])} terminalPages={initial} busy={false} onSelectedTask={vi.fn()} onLoadTerminalPage={loader} onRun={run}/>)
  fireEvent.change(screen.getByPlaceholderText('Pesquisar tasks'), { target: { value: 'needle' } })
  await waitFor(() => expect(loader).toHaveBeenCalledWith('COMPLETE', { q: 'needle' }))
  expect(await screen.findByText('Needle one')).not.toBeNull()
  expect(screen.queryByText('Old complete')).toBeNull()
  const complete = screen.getByRole('region', { name: 'Coluna COMPLETE, 2 tarefas' })
  fireEvent.click(within(complete).getByRole('button', { name: 'Carregar mais' }))
  await waitFor(() => expect(loader).toHaveBeenCalledWith('COMPLETE', { q: 'needle', cursor: 'needle-next' }))
  expect(await screen.findByText('Needle two')).not.toBeNull()
})

it('uses the backend transition when a card is dropped after horizontal navigation', async () => {
  const ready = task('Drag me', 'READY')
  const transitioned = vi.spyOn(api, 'transitionOrchestratorTask').mockResolvedValue({ ...ready, status: 'PENDING' })
  render(<OrchestratorTasks session={session} overview={overview([ready])} busy={false} onSelectedTask={vi.fn()} onRun={run}/>)
  fireEvent.dragStart(screen.getByText('Drag me').closest('article') as HTMLElement)
  const viewport = screen.getByTestId('orchestrator-kanban-scroll')
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: 600 })
  fireEvent.drop(screen.getByRole('region', { name: /Coluna PENDING/ }))
  await waitFor(() => expect(transitioned).toHaveBeenCalledWith(session.id, ready.id, 'PENDING'))
})
