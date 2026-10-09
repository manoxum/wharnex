import { props, session } from '../fixtures'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('uses each popover alert as a link to its owning chat and surface', async () => {
    const current = session()
    const parallel = session()
    parallel.id = 'ses-parallel'
    parallel.interrupted_execution = { plan_id: 'plan-parallel', status: 'awaiting_decision', requested_at: '2026-09-07T10:00:01.000Z', approved: false }
    const view = props(current)
    render(<view.Harness attentionSessions={{ 'chat-1': current, 'chat-2': parallel }} />)
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    fireEvent.click(screen.getByRole('button', { name: /Paralelo.*Execução interrompida/ }))
    await waitFor(() => expect(view.onSelectChat).toHaveBeenCalledWith('chat-2'))
    // Routing goes through the shell's inspectorAttention channel, so the tab
    // switch lands on the state update that follows the chat selection.
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Execução(?: ·|$)/ }).getAttribute('aria-selected')).toBe('true'))
  })
