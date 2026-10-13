import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CodexAsk } from '../../../lib/codex'
import { CodexAskCard } from './CodexAskCard'

afterEach(cleanup)
const ask: CodexAsk = { id: 'ask', turnId: 'turn', itemId: 'item', kind: 'questions', reason: '', command: '', cwd: '', permissions: null, availableDecisions: [], questions: [{ id: 'strategy', header: 'Estratégia', question: 'Qual a estratégia?', isOther: true, options: [{ label: 'Incremental', description: 'Alterações pequenas.' }] }, { id: 'credential', header: 'Credencial', question: 'Qual a credencial?', isSecret: true }] }
it('requires explicit answers to every question and preserves native identifiers', async () => {
  const onAnswer = vi.fn().mockResolvedValue({ ok: true })
  render(<CodexAskCard ask={ask} onAnswer={onAnswer}/>)
  const send = screen.getByRole('button', { name: 'Responder ao Codex' }) as HTMLButtonElement
  expect(send.disabled).toBe(true); expect(onAnswer).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('radio'))
  expect((screen.getByLabelText('Credencial') as HTMLInputElement).type).toBe('password')
  fireEvent.change(screen.getByLabelText('Credencial'), { target: { value: 'ephemeral' } })
  fireEvent.click(send)
  await waitFor(() => expect(onAnswer).toHaveBeenCalledWith({ answers: { strategy: { answers: ['Incremental'] }, credential: { answers: ['ephemeral'] } } }))
})
it('shows reply failures and allows the user to correct them', async () => {
  render(<CodexAskCard ask={{ ...ask, questions: [{ id: 'next', header: 'Next', question: 'Continue?' }] }} onAnswer={vi.fn().mockRejectedValue(new Error('Ligação perdida.'))}/>)
  fireEvent.change(screen.getByLabelText('Next'), { target: { value: 'sim' } })
  fireEvent.click(screen.getByRole('button', { name: 'Responder ao Codex' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Ligação perdida.'))
  expect((screen.getByRole('button', { name: 'Responder ao Codex' }) as HTMLButtonElement).disabled).toBe(false)
})
it('approves only once or refuses the exact native request', async () => {
  const onAnswer = vi.fn().mockResolvedValue({ ok: true })
  render(<CodexAskCard ask={{ ...ask, kind: 'command', command: 'npm test', availableDecisions: ['accept', 'decline'], questions: [] }} onAnswer={onAnswer}/>)
  expect(screen.getByText('npm test')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Permitir uma vez' }))
  await waitFor(() => expect(onAnswer).toHaveBeenCalledWith({ decision: 'accept' }))
})
