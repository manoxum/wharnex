import { props } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { HarnessEvent } from '../../../../../types'
import '../setup'
it('keeps execution status stable instead of blinking while a command is running', () => {
    const view = props()
    const started: HarnessEvent = { id: 'evt-started', session_id: 'ses-agent', type: 'command.started', timestamp: '2026-09-08T15:30:00.000Z', data: { run_id: 'run-1', argv: ['npm', 'test'], cwd: 'services/frontend' } }
    const completed: HarnessEvent = { id: 'evt-completed', session_id: 'ses-agent', type: 'command.completed', timestamp: '2026-09-08T15:30:01.000Z', data: { run_id: 'run-1', argv: ['npm', 'test'], cwd: 'services/frontend', exit_code: 0, success: true } }
    const workspace = (events: HarnessEvent[]) => <view.Harness inspectorProps={{ events }} />
    const rendered = render(workspace([started]))
    expect(screen.getByRole('tab', { name: 'Execução' }).className).not.toContain('execution-pulse')

    fireEvent.click(screen.getByRole('tab', { name: 'Execução' }))
    expect(screen.getByRole('tab', { name: 'Execução' }).className).not.toContain('execution-pulse')

    fireEvent.click(screen.getByRole('tab', { name: 'Plano' }))
    expect(screen.getByRole('tab', { name: 'Execução' }).className).not.toContain('execution-pulse')
    rendered.rerender(workspace([started, completed]))
    expect(screen.getByRole('tab', { name: 'Execução' }).className).not.toContain('execution-pulse')
  })
