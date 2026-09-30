import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyOrchestratorTaskCounts } from '../../../lib/orchestrator/coordination/orchestratorApi'
import type { OrchestratorTask, OrchestratorTerminalTaskPages, Session } from '../../../types'
import { OrchestratorKanban } from './OrchestratorKanban'

const session = {
  id: 'ses-kanban', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-28T00:00:00Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

function task(id: string, status: OrchestratorTask['status']): OrchestratorTask {
  return { id, project_path: '/workspace/demo', title: id, status, condition: 'none', priority: 'normal', parallelizable: false, created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:00:00Z' }
}

function setup(pages: OrchestratorTerminalTaskPages = {}) {
  const counts = emptyOrchestratorTaskCounts()
  counts.COMPLETE = 120
  counts.ARCHIVED = 31
  const props = {
    tasks: [task('Ready task', 'READY'), ...(pages.COMPLETE?.tasks || []), ...(pages.ARCHIVED?.tasks || [])],
    taskCounts: counts, terminalPages: pages, searching: false, session, busy: false,
    onEffort: vi.fn(), onDrag: vi.fn(), onDrop: vi.fn(), onLoadMore: vi.fn(), onSelect: vi.fn(),
  }
  return { ...render(<OrchestratorKanban {...props}/>), props }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps all eight statuses in one horizontal track and exposes durable totals', () => {
  const pages = {
    COMPLETE: { tasks: [task('Complete 1', 'COMPLETE')], total: 120, has_more: true, next_cursor: 'complete-next' },
    ARCHIVED: { tasks: [task('Archived 1', 'ARCHIVED')], total: 31, has_more: false },
  } satisfies OrchestratorTerminalTaskPages
  setup(pages)
  const columns = screen.getAllByRole('region', { name: /Coluna / })
  expect(columns).toHaveLength(8)
  expect(screen.getByRole('region', { name: 'Coluna COMPLETE, 120 tarefas' })).not.toBeNull()
  expect(screen.getByRole('region', { name: 'Coluna ARCHIVED, 31 tarefas' })).not.toBeNull()
  expect(screen.getByTestId('orchestrator-kanban-scroll').firstElementChild?.className).toContain('flex-nowrap')
  expect(screen.getByText('Complete 1')).not.toBeNull()
  expect(screen.queryByText('Complete 2')).toBeNull()
})

it('shows edge controls only for hidden content and respects reduced motion', () => {
  setup()
  const viewport = screen.getByTestId('orchestrator-kanban-scroll')
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 500 },
    scrollWidth: { configurable: true, value: 1800 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const scrollTo = vi.fn(({ left }: ScrollToOptions) => { viewport.scrollLeft = Number(left || 0) })
  Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo })
  fireEvent.scroll(viewport)
  expect((screen.getByRole('button', { name: 'Ver coluna anterior' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Ver coluna seguinte' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Ver coluna seguinte' }))
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  viewport.scrollLeft = 300
  fireEvent.scroll(viewport)
  expect((screen.getByRole('button', { name: 'Ver coluna anterior' }) as HTMLButtonElement).disabled).toBe(false)
})

it('keeps cards and columns keyboard reachable and drops after horizontal scrolling', () => {
  const { props } = setup()
  const card = screen.getByText('Ready task').closest('article') as HTMLElement
  fireEvent.keyDown(card, { key: 'Enter' })
  expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'Ready task' }))
  fireEvent.dragStart(card)
  const viewport = screen.getByTestId('orchestrator-kanban-scroll')
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: 420 })
  fireEvent.drop(screen.getByRole('region', { name: /Coluna PENDING/ }))
  expect(props.onDrop).toHaveBeenCalledWith('PENDING')
})

it('requests the next terminal page without materializing unloaded cards', () => {
  const pages = {
    COMPLETE: { tasks: [task('Complete 1', 'COMPLETE')], total: 3, has_more: true, next_cursor: 'next' },
  } satisfies OrchestratorTerminalTaskPages
  const { props } = setup(pages)
  const complete = screen.getByRole('region', { name: 'Coluna COMPLETE, 120 tarefas' })
  fireEvent.click(within(complete).getByRole('button', { name: 'Carregar mais' }))
  expect(props.onLoadMore).toHaveBeenCalledWith('COMPLETE')
  expect(screen.queryByText('Complete 2')).toBeNull()
})
