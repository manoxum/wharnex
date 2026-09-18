import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { api } from '../../lib/api'
import type { Session } from '../../types'
import { ChatPanel } from '../ChatPanel'
import { OrchestratorWorkspace } from './OrchestratorWorkspace'

vi.mock('../ChatPanel', () => ({ ChatPanel: () => <div data-testid="chat-panel-stub"/> }))

const session = {
  id: 'ses-orchestrator', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-12T15:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

// This workspace stays mounted (CSS-hidden) whenever another mode is active,
// so a naive mount-time setInterval polled every 5s forever even while the
// operator was looking at Agent or Editor mode the whole time.
describe('OrchestratorWorkspace polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(api, 'orchestratorOverview').mockResolvedValue({ plans: [], tasks: [], planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 })
    vi.spyOn(api, 'chatAgentTasks').mockResolvedValue({ tasks: [] })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('does not poll while inactive', async () => {
    render(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active={false} onError={() => undefined}/>)
    await act(async () => { await Promise.resolve() })
    expect(api.orchestratorOverview).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(api.orchestratorOverview).not.toHaveBeenCalled()
  })

  it('polls every 5s once active, and stops again once it becomes inactive', async () => {
    const { rerender } = render(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active onError={() => undefined}/>)
    await act(async () => { await Promise.resolve() })
    expect(api.orchestratorOverview).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve() })
    expect(api.orchestratorOverview).toHaveBeenCalledTimes(2)

    rerender(<OrchestratorWorkspace session={session} chatProps={{} as ComponentProps<typeof ChatPanel>} active={false} onError={() => undefined}/>)
    const callsWhenDeactivated = vi.mocked(api.orchestratorOverview).mock.calls.length
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(api.orchestratorOverview).toHaveBeenCalledTimes(callsWhenDeactivated)
  })
})
