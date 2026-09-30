import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { panelRef, typeInComposer, composerText, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('reopens the latest closed chat directly from the chat switcher', () => {
    const onRestoreChat = vi.fn(async () => undefined)
    const archivedChats = [
      { id: 'arch-latest', title: 'Último fechado', sessionId: 'ses-latest', createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T15:00:00.000Z' },
      { id: 'arch-older', title: 'Mais antigo', sessionId: 'ses-older', createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' },
    ]
    render(
      <ChatPanel session={session} items={[]} chats={[]} archivedChats={archivedChats} activeChatId="" busy={false} onSend={async () => undefined} onNewChat={chatActions.onNewChat} onSelectChat={chatActions.onSelectChat} onArchiveChat={chatActions.onArchiveChat} onRestoreChat={onRestoreChat} onDeleteArchivedChat={chatActions.onDeleteArchivedChat} />,
    )

    const reopen = screen.getByRole('button', { name: 'Reabrir último chat fechado' })
    expect(reopen.getAttribute('title')).toContain('Último fechado')
    fireEvent.click(reopen)
    expect(onRestoreChat).toHaveBeenCalledWith('arch-latest')
  })

it('reopens archived chats from the archive area', () => {
    const onRestoreChat = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} archivedChats={[{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T13:00:00.000Z', chatgptUrl: 'https://chatgpt.com/c/example' }]} activeChatId="" busy={false} onSend={async () => undefined} onNewChat={chatActions.onNewChat} onSelectChat={chatActions.onSelectChat} onArchiveChat={chatActions.onArchiveChat} onRestoreChat={onRestoreChat} onDeleteArchivedChat={chatActions.onDeleteArchivedChat} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Arquivados/ }))
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
    expect(onRestoreChat).toHaveBeenCalledWith('arch-1')
  })
})

it('queues Enter and reserves Ctrl+Enter for an immediate comment while a task is active', async () => {
  const onRequestMode = vi.fn()
  const onComment = vi.fn(async () => undefined)
  const onSend = vi.fn(async () => undefined)
  const ref = panelRef()
  const view = render(
    <ChatPanel ref={ref} session={{ ...session, pending_manual_request_ids: ['req-active'], last_manual_prompt: 'prompt' }} items={[]} chats={[]} activeChatId="chat-1" busy={false} requestMode="plan_first" taskInFlight onRequestMode={onRequestMode} onComment={onComment} onSend={onSend} {...chatActions} />,
  )
  const editor = view.container.querySelector('.composer-rich-editor')!
  expect(screen.getByText(/Ctrl\+Enter comenta/)).toBeTruthy()

  typeInComposer(ref, 'fica para a próxima request principal', 'fica para a próxima request principal'.length)
  fireEvent.keyDown(editor, { key: 'Enter' })
  expect(onSend).toHaveBeenCalledWith('fica para a próxima request principal', [], [], { context: false, prompt: true, result: false, error: false }, 'plan_first')
  expect(composerText(ref)).toBe('')

  typeInComposer(ref, 'mantenha também o teste de regressão', 'mantenha também o teste de regressão'.length)
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
  expect(onComment).toHaveBeenCalledWith('mantenha também o teste de regressão', [])
  expect(composerText(ref)).toBe('')
})

it('renders and operates the waiting queue without placing it in the message stream', () => {
  const onQueueMove = vi.fn()
  const onQueueRemove = vi.fn()
  const onQueueMerge = vi.fn()
  render(<ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} queuedRequests={[
    { id: 'q1', message: 'primeira alteração', attachments: [], projectFiles: [], artifacts: { context: false, prompt: true, result: false, error: false }, requestMode: 'direct', createdAt: new Date().toISOString() },
    { id: 'q2', message: 'segunda alteração', attachments: [], projectFiles: [], artifacts: { context: false, prompt: true, result: false, error: false }, requestMode: 'direct', createdAt: new Date().toISOString() },
  ]} onQueueMove={onQueueMove} onQueueRemove={onQueueRemove} onQueueMerge={onQueueMerge} onSend={async () => undefined} {...chatActions} />)
  expect(screen.getByText('primeira alteração')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Descer request' })[0])
  expect(onQueueMove).toHaveBeenCalledWith('q1', 1)
  fireEvent.click(screen.getAllByRole('button', { name: 'Mesclar com a próxima' })[0])
  expect(onQueueMerge).toHaveBeenCalledWith('q1')
  fireEvent.click(screen.getAllByRole('button', { name: 'Remover request' })[0])
  expect(onQueueRemove).toHaveBeenCalledWith('q1')
})

it('moves the latest TODO snapshot to the composer task panel and makes iteration artifacts clickable', () => {
  const view = render(<ChatPanel session={session} items={[{
    id: 'result', role: 'harness', text: 'Implementação concluída.\n\n## TODO\n- [x] fila\n- [ ] validação final', iteration: { id: 'it', requestId: 'req-123', phase: 'result', artifacts: ['prompt'] },
  }]} chats={[]} activeChatId="chat-1" busy={false} artifactContent={{ prompt: '# Prompt\n\nconteúdo real' }} onSend={async () => undefined} {...chatActions} />)
  expect(screen.queryByRole('heading', { name: 'TODO' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tarefas TODO' }))
  expect(screen.getByText('validação final')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Ver prompt' }))
  expect(screen.getByText('conteúdo real')).toBeTruthy()
  expect(view.container.querySelector('.artifact-inspector')).toBeTruthy()
})

it('renders operational notices and visible ChatGPT activity differently from messages', () => {
  render(<ChatPanel session={session} items={[
    { id: 'notice', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Correção automática preparada.' },
    { id: 'thought', role: 'harness', source: 'chatgpt', presentation: 'thought', text: 'A analisar os testes visíveis.' },
  ]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />)
  expect(document.querySelector('.chat-notice')).toBeTruthy()
  expect(document.querySelector('.chat-thought')).toBeTruthy()
})

it('requests correction guidance before replacing a pending plan proposal', async () => {
  const onCorrectPlan = vi.fn(async () => undefined)
  const item = { id: 'plan-pending', role: 'harness' as const, source: 'chatgpt' as const, presentation: 'plan' as const, text: '## TODO\n- [ ] Alterar fluxo', approval: { status: 'pending' as const, requestId: 'req-plan' } }
  render(
    <ChatPanel session={session} items={[item]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onCorrectPlan={onCorrectPlan} {...chatActions} />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Solicitar correção' }))
  const input = document.querySelector<HTMLInputElement>('.app-dialog-field input')!
  fireEvent.change(input, { target: { value: 'Adicionar rollback explícito' } })
  fireEvent.click(document.querySelector<HTMLButtonElement>('.app-dialog-button.primary')!)

  await waitFor(() => expect(onCorrectPlan).toHaveBeenCalledWith(item, 'Adicionar rollback explícito'))
})
