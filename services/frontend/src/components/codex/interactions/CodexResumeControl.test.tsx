import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CodexThread } from '../../../lib/codex'
import { CodexResumeControl } from './CodexResumeControl'
const resume = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/desktop/bridge/desktop', () => ({ desktopBridge: () => ({ codex: { resumeNative: resume } }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const thread: CodexThread = { projectPath: '/project', chatId: 'chat', requestId: 'req_native', threadId: 'thread', title: 'Work', native: true, status: 'attention', error: '', messages: [], tokenUsage: null, resumeAvailable: true, pauseReason: 'quota', selfEvolution: true }
it('resumes only an explicitly submitted owned continuation and keeps failures retryable', async () => {
  resume.mockRejectedValue(new Error('Conta indisponível.'))
  render(<CodexResumeControl thread={thread} accountLabel="Segunda conta"/>)
  expect(resume).not.toHaveBeenCalled()
  expect(screen.getByRole('button').textContent).toBe('')
  expect(screen.getByRole('button').getAttribute('title')).toContain('renovação da quota')
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('heading')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar manualmente' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Conta indisponível.'))
  expect(resume).toHaveBeenCalledWith('/project', 'chat', 'req_native')
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false)
})
it('keeps context exhaustion distinct from quota exhaustion', () => {
  render(<CodexResumeControl thread={{ ...thread, pauseReason: 'context' }}/>)
  expect(screen.getByRole('button').getAttribute('title')).toContain('trocar de conta não aumenta')
  expect(screen.getByRole('button').getAttribute('title')).not.toContain('quota')
})
it('offers continuation for a native attention failure even when an older snapshot lacks the recovery flag', () => {
  render(<CodexResumeControl thread={{ ...thread, resumeAvailable: undefined, pauseReason: undefined, error: "You've hit your usage limit. Try again later." }}/>)
  expect(screen.getByRole('button', { name: 'Continuar manualmente' })).toBeTruthy()
  expect(resume).not.toHaveBeenCalled()
})
it('disables the play action while the explicit continuation is pending', async () => {
  let complete!: () => void
  resume.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve }))
  render(<CodexResumeControl thread={thread}/>)
  const button = screen.getByRole('button', { name: 'Continuar manualmente' })
  fireEvent.click(button); fireEvent.click(button)
  expect(resume).toHaveBeenCalledTimes(1)
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  complete()
  await waitFor(() => expect(resume).toHaveBeenCalledTimes(1))
})
