import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OrchestratorOverview as OverviewData, Session } from '../../types'
import { OrchestratorOverview } from './OrchestratorOverview'

const session = {
  id: 'ses-orchestrator', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-12T15:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

describe('OrchestratorOverview planning queue', () => {
  it('keeps every submitted objective visible while another draft exists', () => {
    const overview = {
      plans: [{ id: 'opl-1', project_path: session.project_path, title: 'Existing draft', objective: 'First result', status: 'DRAFT', created_at: '2026-09-12T14:58:00.000Z', updated_at: '2026-09-12T14:59:00.000Z' }],
      tasks: [],
      planning_requests: [
        { request_id: 'orp-first', task_id: 'cat-first', objective: 'Split the API safely', status: 'RUNNING', attempt: 1, max_attempts: 3, created_at: '2026-09-12T15:00:00.000Z', updated_at: '2026-09-12T15:01:00.000Z' },
        { request_id: 'orp-second', task_id: 'cat-second', objective: 'Polish the dashboard', status: 'PENDING', attempt: 0, max_attempts: 3, created_at: '2026-09-12T15:02:00.000Z', updated_at: '2026-09-12T15:02:00.000Z' },
        { request_id: 'orp-third', task_id: 'cat-third', objective: 'Recover interrupted planning', status: 'ATTENTION', attempt: 3, max_attempts: 8, last_error: 'Composer unavailable', created_at: '2026-09-12T15:03:00.000Z', updated_at: '2026-09-12T15:03:00.000Z' },
      ],
      mutation_slots: 1,
      mutation_slots_used: 0,
    } satisfies OverviewData

    render(<OrchestratorOverview
      session={session}
      overview={overview}
      busy={false}
      onProposal={vi.fn()}
      onRun={async () => undefined}
      onOpenTasks={vi.fn()}
      onSelectTask={vi.fn()}
    />)

    expect(screen.getByRole('heading', { name: 'Em planejamento' })).toBeTruthy()
    expect(screen.getByText('Split the API safely')).toBeTruthy()
    expect(screen.getByText('Polish the dashboard')).toBeTruthy()
    expect(screen.getByText('orp-first')).toBeTruthy()
    expect(screen.getByText('orp-second')).toBeTruthy()
    expect(screen.getByText('Recover interrupted planning')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retentar' })).toBeTruthy()
  })
})
