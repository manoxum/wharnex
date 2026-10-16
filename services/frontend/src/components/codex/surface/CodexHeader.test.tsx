import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CodexStatus } from '../../../lib/codex'
import { CodexHeader } from './CodexHeader'

const account = { type: 'chatgpt', email: 'operator@example.test', planType: 'plus' }
const status: CodexStatus = { connected: true, account, rateLimits: null, usage: null, models: [], threads: [] }
describe('Codex account presentation', () => {
  it('shows connected identity during refresh without a first-access prompt', () => {
    render(<CodexHeader status={status} loading available onRefresh={vi.fn()} onAccountAction={vi.fn()}/>)
    expect(screen.getByText('Ligado')).toBeTruthy()
    expect(screen.getByText(account.email)).toBeTruthy()
    expect(screen.queryByText('Ligue a sua conta para começar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entrar no Codex' })).toBeNull()
  })
  it('uses the runtime connection as authoritative when the account identity is temporarily unavailable', () => {
    render(<CodexHeader status={{ ...status, account: null }} loading available onRefresh={vi.fn()} onAccountAction={vi.fn()}/>)
    expect(screen.getByText('Ligado')).toBeTruthy()
    expect(screen.getByText('Conta ligada')).toBeTruthy()
    expect(screen.queryByText('Ligue a sua conta para começar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entrar no Codex' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
  })
  it('distinguishes a stored account from an active runtime connection', () => {
    render(<CodexHeader status={{ ...status, connected: false, account: null, accounts: { selected: 'work', profiles: [{ id: 'work', label: 'Trabalho', account, rateLimits: null }] } }} loading={false} available onRefresh={vi.fn()} onAccountAction={vi.fn()}/>)
    expect(screen.getByText('Sem ligação')).toBeTruthy()
    expect(screen.getByText(account.email)).toBeTruthy()
    expect(screen.queryByText('Ligue a sua conta para começar')).toBeNull()
  })
  it('does not invite a second login while the first account inspection is pending', () => {
    render(<CodexHeader loading available onRefresh={vi.fn()} onAccountAction={vi.fn()}/>)
    expect(screen.getByText('A verificar conta…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Entrar no Codex' })).toBeNull()
  })
})
