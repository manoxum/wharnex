import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from './ChatPanel'
import type { Session } from '../types'

const session = {
  id: 'ses-test',
  project_path: '/tmp/demo',
  state: 'ready',
  execution_mode: 'protected',
  automation_mode: 'manual',
  created_at: new Date().toISOString(),
  context: {
    id: 'ctx-test',
    manifest: {
      id: 'ctx-test',
      project_root: '/tmp/demo',
      sha256: 'abcdef1234567890',
      files: [],
      excluded: [],
      text_truncated: false,
    },
  },
} satisfies Session

const chatActions = {
  archivedChats: [],
  onNewChat: async () => undefined,
  onSelectChat: async () => undefined,
  onArchiveChat: async () => undefined,
  onRestoreChat: async () => undefined,
  onDeleteArchivedChat: async () => undefined,
}

describe('ChatPanel', () => {
  afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

  it('does not return scrollIntoView result as an effect cleanup', () => {
    const scrollIntoView = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(scrollIntoView).toHaveBeenCalled()
    expect(() => view.unmount()).not.toThrow()
  })


  it('renders Harness responses as sanitized Markdown instead of raw markdown text', () => {
    render(
      <ChatPanel session={session} items={[{ id: 'md-1', role: 'harness', text: '## Prioridade\n\nA funcionalidade **Perfil Inteligente** é a primeira recomendação.' }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Prioridade' })).toBeTruthy()
    expect(screen.getByText('Perfil Inteligente').tagName).toBe('STRONG')
    expect(screen.queryByText('**Perfil Inteligente**')).toBeNull()
  })

  it('shows message date/time and copies any previous message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const createdAt = '2026-09-03T15:36:00.000Z'
    render(
      <ChatPanel session={session} items={[{ id: 'm1', role: 'user', text: 'mensagem anterior', createdAt }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(createdAt)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensagem' }))
    expect(writeText).toHaveBeenCalledWith('mensagem anterior')
  })

  it('selects files and submits them with the message', async () => {
    const onSend = vi.fn(async () => undefined)
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={onSend} {...chatActions} />,
    )
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['spec'], 'spec.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…'), { target: { value: 'implementar' } })
    fireEvent.submit(view.container.querySelector('form')!)
    expect(onSend).toHaveBeenCalledWith('implementar', [file], { context: false, prompt: true, result: false, error: false }, 'direct')
  })

  it('adds files pasted from the operating-system clipboard', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    const file = new File(['image'], 'captura.png', { type: 'image/png' })
    const composer = view.container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.paste(composer, { clipboardData: { files: [file], items: [] } })
    expect(view.container.textContent).toContain('captura.png')
    expect((composer as HTMLTextAreaElement).value).toBe('')
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('requires explicit confirmation for a prepared ChatGPT draft', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} preparedAttachmentCount={2} onSend={async () => undefined} onConfirmPrepared={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByText('Preparação enviada ao ChatGPT')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirmar e enviar/ })).toBeTruthy()
  })

  it('keeps system artifact selectors inside the Wharness composer and marks automatic payloads', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} artifactSelection={{ context: true, prompt: true, result: false, error: false }} artifactRequired={{ context: true }} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…').closest('form')!
    expect(composer.querySelector('.composer-action-row')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Contexto ZIP' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Prompt' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('moves execution and automation choices into compact composer icons', () => {
    const onExecutionMode = vi.fn()
    const onAutomationMode = vi.fn()
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} executionMode="protected" automationMode="manual" onExecutionMode={onExecutionMode} onAutomationMode={onAutomationMode} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…').closest('form')!
    expect(composer.querySelector('[aria-label="Proteção de execução"]')).toBeTruthy()
    expect(composer.querySelector('[aria-label="Automação de execução"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Protected' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Unprotected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(onExecutionMode).toHaveBeenCalledWith('unprotected')
    expect(onAutomationMode).toHaveBeenCalledWith('auto')
  })

  it('keeps Unprotected disabled in the composer during self-evolution', () => {
    render(
      <ChatPanel session={{ ...session, self_evolution: true }} items={[]} chats={[]} activeChatId="chat-1" busy={false} executionMode="protected" automationMode="auto" onExecutionMode={vi.fn()} onAutomationMode={vi.fn()} onSend={async () => undefined} {...chatActions} />,
    )
    expect((screen.getByRole('button', { name: 'Unprotected' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps composer actions outside the scrolling text surface', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const scrollArea = composer.querySelector('.composer-scroll-area') as HTMLElement
    const footer = composer.querySelector('.composer-footer') as HTMLElement
    const send = screen.getByRole('button', { name: 'Enviar ao agente' })

    expect(scrollArea.contains(footer)).toBe(false)
    expect(footer.contains(send)).toBe(true)
  })

  it('grows the composer as multiline content expands, bounded by the configured maximum', async () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-growth" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const scrollArea = composer.querySelector('.composer-scroll-area') as HTMLElement
    const footer = composer.querySelector('.composer-footer') as HTMLElement
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 260 })
    Object.defineProperty(scrollArea, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(footer, 'offsetHeight', { configurable: true, value: 52 })
    Object.defineProperty(composer, 'offsetHeight', { configurable: true, value: 156 })
    Object.defineProperty(composer, 'clientHeight', { configurable: true, value: 154 })

    fireEvent.change(textarea, { target: { value: 'linha 1\nlinha 2\nlinha 3\nlinha 4' } })

    await waitFor(() => expect(composer.style.height).toBe('420px'))
  })

  it('reopens archived chats from the archive area', () => {
    const onRestoreChat = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} archivedChats={[{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T13:00:00.000Z', chatgptUrl: 'https://chatgpt.com/c/example' }]} activeChatId="" busy={false} onSend={async () => undefined} onNewChat={chatActions.onNewChat} onSelectChat={chatActions.onSelectChat} onArchiveChat={chatActions.onArchiveChat} onRestoreChat={onRestoreChat} onDeleteArchivedChat={chatActions.onDeleteArchivedChat} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Arquivados/ }))
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Reabrir/ }))
    expect(onRestoreChat).toHaveBeenCalledWith('arch-1')
  })
})


it('queues Enter and reserves Ctrl+Enter for an immediate comment while a task is active', async () => {
  const onRequestMode = vi.fn()
  const onComment = vi.fn(async () => undefined)
  const onSend = vi.fn(async () => undefined)
  const view = render(
    <ChatPanel session={{ ...session, pending_manual_request_ids: ['req-active'], last_manual_prompt: 'prompt' }} items={[]} chats={[]} activeChatId="chat-1" busy={false} requestMode="plan_first" taskInFlight onRequestMode={onRequestMode} onComment={onComment} onSend={onSend} {...chatActions} />,
  )
  const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement
  expect(screen.getByText(/Ctrl\+Enter comenta/)).toBeTruthy()

  fireEvent.change(textarea, { target: { value: 'fica para a próxima request principal' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })
  expect(onSend).toHaveBeenCalledWith('fica para a próxima request principal', [], { context: false, prompt: true, result: false, error: false }, 'plan_first')
  expect(textarea.value).toBe('')

  fireEvent.change(textarea, { target: { value: 'mantenha também o teste de regressão' } })
  fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
  expect(onComment).toHaveBeenCalledWith('mantenha também o teste de regressão', [])
  expect(textarea.value).toBe('')
})

it('renders and operates the waiting queue without placing it in the message stream', () => {
  const onQueueMove = vi.fn()
  const onQueueRemove = vi.fn()
  const onQueueMerge = vi.fn()
  render(<ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} queuedRequests={[
    { id: 'q1', message: 'primeira alteração', attachments: [], artifacts: { context: false, prompt: true, result: false, error: false }, requestMode: 'direct', createdAt: new Date().toISOString() },
    { id: 'q2', message: 'segunda alteração', attachments: [], artifacts: { context: false, prompt: true, result: false, error: false }, requestMode: 'direct', createdAt: new Date().toISOString() },
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
