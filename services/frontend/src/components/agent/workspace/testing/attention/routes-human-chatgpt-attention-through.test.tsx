import { props, session } from '../fixtures'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import '../setup'
it('routes human ChatGPT attention through the popover and highlights Engine', async () => {
    const current = session()
    const onHumanAction = vi.fn()
    const notice: DesktopChatGPTHumanAction = { cacheKey: 'chat-1', active: true, kind: 'verification', source: 'dom', message: 'Conclua a verificação humana.', detectedAt: '2026-09-05T13:00:00.000Z' }
    const view = props(current, { notice, nonce: 0, onAction: onHumanAction })
    const { rerender } = render(<view.Harness attentionSessions={{ 'chat-1': current }} chatgptHumanActions={{ 'chat-1': notice }} />)
    expect(screen.queryByRole('button', { name: 'Ação humana necessária no ChatGPT' })).toBeNull()
    expect(screen.getByRole('tab', { name: /^Engine(?: ·|$)/ }).className).toContain('text-whx-warning!')
    fireEvent(window, new CustomEvent('wharnex:open-attention-drawer'))
    fireEvent.click(screen.getByRole('button', { name: /Principal.*Ação humana necessária no ChatGPT/ }))
    expect(onHumanAction).toHaveBeenCalledTimes(1)
    rerender(<view.Harness attentionSessions={{ 'chat-1': current }} chatgptHumanActions={{ 'chat-1': notice }} nonce={1} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Engine(?: ·|$)/ }).getAttribute('aria-selected')).toBe('true'))
  })
