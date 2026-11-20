import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessEvent, Session } from '../../../../types'
import { OperationalOutput } from './OperationalOutput'

const events = vi.hoisted(() => ({ durable: [] as HarnessEvent[] }))
vi.mock('../../../execution/history/useExecutionHistory', () => ({ useExecutionHistory: () => ({ events: events.durable, loading: false, error: '' }) }))

describe('operational output ledger', () => {
  it('keeps persisted evidence visible after the snapshot has cleared and merges live events once', () => {
    const session = { id: 'session', project_path: '/work', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: '' } as Session
    const persisted = { id: 'persisted', timestamp: '2026-10-15T10:00:00Z', type: 'execution.completed', data: {} } as HarnessEvent
    const live = { ...persisted, id: 'live', timestamp: '2026-10-15T10:00:01Z' }
    events.durable = [persisted]
    render(<OperationalOutput session={session} events={[persisted, live]} active/>)
    expect(session.last_execution).toBeUndefined()
    const log = within(screen.getByRole('region', { name: 'Saída de execução' })).getByRole('log', { name: 'Eventos de execução' })
    expect(within(log).getAllByText('Execução concluída')).toHaveLength(2)
  })
})
