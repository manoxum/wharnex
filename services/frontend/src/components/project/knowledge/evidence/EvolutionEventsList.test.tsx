import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessEvent } from '../../../../types/agent/task-queue'
import { EvolutionEventsList } from './EvolutionEventsList'

describe('EvolutionEventsList', () => {
  it('keeps event rows individually available with an operational summary and selection', () => {
    const events: HarnessEvent[] = [
      { id: 'event-1', session_id: 'session-1', type: 'verification.started', timestamp: '2026-10-15T10:00:00Z', data: { target: 'npm test' }, project_path: '/workspace/wharnex', project_name: 'wharnex', category: 'verification' },
      { id: 'event-2', session_id: 'session-1', type: 'workflow.prompt_ready', timestamp: '2026-10-15T10:01:00Z', data: {}, project_path: '/workspace/wharnex', project_name: 'wharnex', category: 'workflow' },
    ]
    const onToggle = vi.fn()
    const { container } = render(<EvolutionEventsList events={events} selected={new Set()} onToggle={onToggle} total={2} onShowMore={vi.fn()}/> )

    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Verificação iniciada')
    expect(cards[0].textContent).toContain('CHECK')
    expect(cards[0].textContent).toContain('verification')
    expect(cards[0].textContent).toContain('npm test')
    expect(cards[1].textContent).toContain('Continuação pronta para o ChatGPT')
    expect(cards[0].className).toContain('[content-visibility:auto]')
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(events[0].timestamp)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar evento verification.started' }))
    expect(onToggle).toHaveBeenCalledWith('event-1')
  })

  it('formats the event payload only when its details are opened', async () => {
    const toJSON = vi.fn(() => ({ result: 'verification failed' }))
    const event: HarnessEvent = {
      id: 'event-1', session_id: 'session-1', type: 'execution.failed', timestamp: '2026-10-15T10:00:00Z',
      data: { toJSON }, project_path: '/workspace/wharnex', project_name: 'wharnex', category: 'execution',
    }
    render(<EvolutionEventsList events={[event]} selected={new Set()} onToggle={vi.fn()} total={1} onShowMore={vi.fn()}/> )

    expect(toJSON).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Dados'))
    await waitFor(() => expect(toJSON).toHaveBeenCalledOnce())
    expect(screen.getByText(/verification failed/)).toBeTruthy()
  })
})
