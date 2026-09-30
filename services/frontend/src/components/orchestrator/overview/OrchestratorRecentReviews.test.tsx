import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { normalizeOrchestratorOverview } from '../../../lib/orchestrator/coordination/orchestratorApi'
import type { OrchestratorOverview, OrchestratorRecentReview, OrchestratorTask } from '../../../types'
import { OrchestratorRecentReviews } from './OrchestratorRecentReviews'

function task(id: string): OrchestratorTask {
  return {
    id, project_path: '/project', title: id, status: 'REVIEW', condition: 'none', priority: 'normal',
    parallelizable: false, created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z',
  }
}

function review(index: number): OrchestratorRecentReview {
  return {
    run_id: `run-${index}`, task_id: `review-${index}`, title: `Review ${index}`, status: 'REVIEW',
    completed_at: `2026-09-29T0${index}:00:00Z`,
  }
}

it('normalizes a missing recent review collection to an empty list', () => {
  const overview = normalizeOrchestratorOverview({
    plans: [], tasks: [], task_counts: {} as OrchestratorOverview['task_counts'], planning_requests: [],
    mutation_slots: 1, mutation_slots_used: 0,
  } as OrchestratorOverview)

  expect(overview.recent_reviews).toEqual([])
})

it('renders the supplied durable order and caps the list at five entries', () => {
  const reviews = [6, 5, 4, 3, 2, 1].map(review)
  const tasks = reviews.map((item) => task(item.task_id))
  render(<OrchestratorRecentReviews reviews={reviews} tasks={tasks} onSelectTask={vi.fn()}/>)

  const buttons = screen.getAllByRole('button')
  expect(buttons).toHaveLength(5)
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
    'Abrir revisão de Review 6',
    'Abrir revisão de Review 5',
    'Abrir revisão de Review 4',
    'Abrir revisão de Review 3',
    'Abrir revisão de Review 2',
  ])
})

it('shows a specific empty state when no task is waiting for completion', () => {
  render(<OrchestratorRecentReviews reviews={[]} tasks={[]} onSelectTask={vi.fn()}/>)
  expect(screen.getByText('Nenhuma tarefa aguarda conclusão em REVIEW.')).not.toBeNull()
})

it('selects the same overview task when a pending review is opened', () => {
  const selected = vi.fn()
  const reviewItem = review(3)
  const reviewTask = task(reviewItem.task_id)
  render(<OrchestratorRecentReviews reviews={[reviewItem]} tasks={[reviewTask]} onSelectTask={selected}/>)

  fireEvent.click(screen.getByRole('button', { name: 'Abrir revisão de Review 3' }))
  expect(selected).toHaveBeenCalledWith(reviewTask)
})
