import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { api } from '../../../lib/transport/http/api'
import { emptyOrchestratorTaskCounts } from '../../../lib/orchestrator/coordination/orchestratorApi'
import type { Session } from '../../../types'
import { ChatPanel } from '../../chat/panel/ChatPanel'
import { OrchestratorWorkspace } from './OrchestratorWorkspace'

vi.mock('../../chat/panel/ChatPanel', () => ({ ChatPanel: () => <div data-testid="chat-panel-stub"/> }))

const session = {
  id: 'ses-orchestrator', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-12T15:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

describe('OrchestratorWorkspace notification routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(api, 'orchestratorOverview').mockResolvedValue({ plans: [], tasks: [], task_counts: emptyOrchestratorTaskCounts(), planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 })
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [] })
    vi.spyOn(api, 'orchestratorTasks').mockResolvedValue({ tasks: [], total: 0, has_more: false })
    vi.spyOn(api, 'orchestratorTaskRuns').mockResolvedValue({ runs: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens Tasks and selects a notification target after refreshing a stale overview', async () => {
    const task = {
      id: 'otk-from-notification', project_path: session.project_path, title: 'Task from notification', status: 'REVIEW' as const,
      condition: 'none' as const, priority: 'normal' as const, parallelizable: false,
      created_at: '2026-09-28T03:00:00Z', updated_at: '2026-09-28T03:05:00Z',
    }
    const view = render(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active onError={() => undefined}/>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(api.orchestratorOverview).toHaveBeenCalledTimes(1)

    const counts = emptyOrchestratorTaskCounts()
    counts.REVIEW = 1
    vi.mocked(api.orchestratorOverview).mockResolvedValue({ plans: [], tasks: [task], task_counts: counts, planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 })
    view.rerender(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active focusTaskId={task.id} focusTaskNonce={1} onError={() => undefined}/>)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(api.orchestratorOverview).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('tab', { name: /Tasks/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(task.id).textContent).toBe(task.id)
  })
})
