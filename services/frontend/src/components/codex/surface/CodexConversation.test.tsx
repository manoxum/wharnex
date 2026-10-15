import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexConversation } from './CodexConversation'
import type { CodexThread } from '../../../lib/codex'

const cancel = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/desktop/bridge/desktop', () => ({ desktopBridge: () => ({ codex: { cancelNativeRequest: cancel } }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('keeps native cancellation failures visible and retryable', async () => {
  cancel.mockRejectedValue(new Error('Não foi possível contactar o Codex.'))
  const thread: CodexThread = { projectPath: '/project', chatId: 'chat', requestId: 'req_native', threadId: 'thread', title: 'Native', native: true, status: 'running', error: '', messages: [], tokenUsage: null }
  render(<CodexConversation thread={thread}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido Codex' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('contactar o Codex'))
  expect(cancel).toHaveBeenCalledWith('/project', 'chat', 'req_native')
  expect(screen.getByRole('button', { name: 'Cancelar pedido Codex' }).hasAttribute('disabled')).toBe(false)
})
