import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatBindingRecovery } from './ChatBindingRecovery'
import { api } from '../lib/api'

describe('chat binding recovery', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => cleanup())

  it('proposes a recovered conversation and binds it only when the operator confirms', async () => {
    vi.spyOn(api, 'workspaceChatBindingRecovery').mockResolvedValue({
      chat_id: 'chat-1', bound: false,
      candidates: [{ chatgpt_url: 'https://chatgpt.com/c/abc', conversation_id: 'abc', evidence: 'transcript', conflict: false }],
    })
    const remote = vi.spyOn(api, 'updateWorkspaceChatRemote').mockResolvedValue({ ok: true })
    const onBind = vi.fn().mockReturnValue(true)
    render(<ChatBindingRecovery chatId="chat-1" onBind={onBind} />)

    fireEvent.click(screen.getByRole('button', { name: 'Recuperar vínculo automático' }))
    await screen.findByText('https://chatgpt.com/c/abc')
    // Proposing must not bind: nothing is decided until the operator acts.
    expect(onBind).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))
    expect(onBind).toHaveBeenCalledWith('https://chatgpt.com/c/abc')
    await waitFor(() => expect(remote).toHaveBeenCalledWith('chat-1', { chatgpt_url: 'https://chatgpt.com/c/abc' }))
  })

  it('refuses to offer a conversation another chat already owns', async () => {
    vi.spyOn(api, 'workspaceChatBindingRecovery').mockResolvedValue({
      chat_id: 'chat-2', bound: false,
      candidates: [{ chatgpt_url: 'https://chatgpt.com/c/taken', conversation_id: 'taken', evidence: 'agent_queue', bound_to_chat_id: 'other', conflict: true }],
    })
    render(<ChatBindingRecovery chatId="chat-2" onBind={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar vínculo automático' }))
    await screen.findByText('Já vinculado a outro chat')
    expect(screen.queryByRole('button', { name: 'Vincular' })).toBeNull()
  })

  it('falls back to a pasted address when no evidence survives', async () => {
    vi.spyOn(api, 'workspaceChatBindingRecovery').mockResolvedValue({ chat_id: 'chat-3', bound: false, candidates: [] })
    vi.spyOn(api, 'updateWorkspaceChatRemote').mockResolvedValue({ ok: true })
    const onBind = vi.fn().mockReturnValue(true)
    render(<ChatBindingRecovery chatId="chat-3" onBind={onBind} />)

    fireEvent.click(screen.getByRole('button', { name: 'Recuperar vínculo automático' }))
    await screen.findByText(/Nenhuma conversa encontrada/)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://chatgpt.com/c/manual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vincular este endereço' }))
    expect(onBind).toHaveBeenCalledWith('https://chatgpt.com/c/manual')
  })

  it('reports an address the renderer rejects instead of pretending it bound', async () => {
    vi.spyOn(api, 'workspaceChatBindingRecovery').mockResolvedValue({ chat_id: 'chat-4', bound: false, candidates: [] })
    const remote = vi.spyOn(api, 'updateWorkspaceChatRemote').mockResolvedValue({ ok: true })
    render(<ChatBindingRecovery chatId="chat-4" onBind={vi.fn().mockReturnValue(false)} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/c/nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vincular este endereço' }))
    await screen.findByText(/não é uma conversa válida/)
    expect(remote).not.toHaveBeenCalled()
  })
})
