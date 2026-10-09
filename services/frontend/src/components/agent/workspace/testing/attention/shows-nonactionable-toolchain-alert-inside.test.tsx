import { props, session } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('shows a non-actionable toolchain alert inside the popover', () => {
    const blocked = session()
    blocked.state = 'failed'
    blocked.failure_kind = 'host_build_toolchain_mismatch'
    blocked.last_repair_error = 'self-evolution host build failed: Electron failed to install correctly.'
    const view = props(blocked)
    render(<view.Harness attentionSessions={{ 'chat-1': blocked }} />)
    expect(screen.getByRole('tab', { name: /^Execução(?: ·|$)/ }).className).toContain('text-whx-danger!')
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    expect(screen.getByText('Build do host bloqueado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Permitir rede e repetir' })).toBeNull()
  })
