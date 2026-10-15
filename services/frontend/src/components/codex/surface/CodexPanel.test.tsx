import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexPanel } from './CodexPanel'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/codex', () => ({ useCodexStatus: () => ({ loading: false, error: '', refresh, data: {
  connected: true, account: { email: 'operator@example.test', planType: 'plus' }, models: [], usage: null,
  rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: null },
  threads: [{ projectPath: '/project', chatId: 'chat', threadId: 'thread', title: 'Rever parser', status: 'idle', messages: [{ id: 'message', text: 'Resultado do Codex' }], error: '', tokenUsage: null }],
} }) }))
vi.mock('../../../lib/desktop/bridge/desktop', () => ({ desktopBridge: () => ({ codex: { history: async () => ({ chatId: 'chat', messages: [] }) } }) }))
afterEach(cleanup)
describe('native Codex surface', () => {
  it('shows the connected account and owned conversation without terminal launchers', async () => {
    render(<CodexPanel projectPath="/project" chatId="chat"/>)
    expect(screen.getByText('operator@example.test')).toBeTruthy()
    expect(screen.getByText('Resultado do Codex')).toBeTruthy()
    expect(screen.queryByText(/Claude Code|Cline/)).toBeNull()
    expect(screen.queryByText(/Enviar para.*terminal/)).toBeNull()
  })
  it('shows actual rate limits and marks absent usage as unavailable', () => {
    render(<CodexPanel projectPath="/project" chatId="chat"/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Consumo' }))
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Uso da janela principal' }).getAttribute('aria-valuenow')).toBe('25')
    expect(screen.getByText('Limite não disponibilizado pela conta.')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
