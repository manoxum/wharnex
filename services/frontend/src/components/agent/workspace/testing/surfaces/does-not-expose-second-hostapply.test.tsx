import { props, session } from '../fixtures'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('does not expose a second host-apply approval for a verified candidate', () => {
    const ready = session()
    ready.state = 'verified'
    ready.pending_host_changes = [{
      plan: ready.plan!,
      execution: { plan_id: 'plan-agent', success: true, started_at: '2026-09-07T10:00:00.000Z', completed_at: '2026-09-07T10:00:01.000Z', commands: [] },
      verified_at: '2026-09-07T10:00:01.000Z',
    }]
    const view = props(ready)
    render(<view.Harness attentionSessions={{ 'chat-1': ready }} />)
    expect(screen.queryByRole('button', { name: 'Aplicar no host' })).toBeNull()
    expect(screen.getByText('Integração pendente de recuperação')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^Plano(?: ·|$)/ }).className).not.toContain('text-whx-success!')
    expect(view.onApply).not.toHaveBeenCalled()
  })
