import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { ChatAgentTaskEvent } from '../types'
import { ChatAgentTaskTimeline } from './ChatAgentTaskTimeline'

function event(patch: Partial<ChatAgentTaskEvent>): ChatAgentTaskEvent {
  return {
    id: 'cae-1', task_id: 'cat-1', request_id: 'req-1', root_request_id: 'req-root', session_id: 'ses-1',
    chat_id: 'chat-1', project_id: '/home/op/alpha', type: 'chatgpt.recovery_keep_continue',
    occurred_at: '2026-09-20T20:00:00Z', data: { reason: 'completed-without-bundle' },
    ...patch,
  }
}

describe('ChatAgentTaskTimeline', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders nothing until enabled, so the drawer poll never fans out into one request per card', () => {
    const spy = vi.spyOn(api, 'chatAgentTaskEvents')
    const { container } = render(<ChatAgentTaskTimeline taskId="cat-1" enabled={false}/>)
    expect(container.firstChild).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('fetches and renders the ledger once enabled', async () => {
    vi.spyOn(api, 'chatAgentTaskEvents').mockResolvedValue({ events: [
      event({ id: 'cae-1', type: 'chatgpt.recovery_reload', occurred_at: '2026-09-20T19:58:00Z', data: { reason: 'surface' } }),
      event({ id: 'cae-2', type: 'chatgpt.recovery_keep_continue', occurred_at: '2026-09-20T20:00:00Z' }),
    ] })
    render(<ChatAgentTaskTimeline taskId="cat-1" enabled={true}/>)
    expect(await screen.findByText('Recarregou a conversa')).toBeTruthy()
    expect(screen.getByText('Enviou "keep continue"')).toBeTruthy()
    expect(api.chatAgentTaskEvents).toHaveBeenCalledWith('cat-1')
  })

  it('shows an explicit empty state rather than nothing when the ledger has no events', async () => {
    vi.spyOn(api, 'chatAgentTaskEvents').mockResolvedValue({ events: [] })
    render(<ChatAgentTaskTimeline taskId="cat-1" enabled={true}/>)
    expect(await screen.findByText('Nenhuma decisão registada para esta tarefa.')).toBeTruthy()
  })

  it('surfaces a fetch failure instead of leaving the section silently empty', async () => {
    vi.spyOn(api, 'chatAgentTaskEvents').mockRejectedValue(new Error('network down'))
    render(<ChatAgentTaskTimeline taskId="cat-1" enabled={true}/>)
    expect(await screen.findByText('network down')).toBeTruthy()
  })
})
