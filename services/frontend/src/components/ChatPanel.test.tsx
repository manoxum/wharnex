import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(onSend).toHaveBeenCalledWith('implementar', [file], { context: false, prompt: true, result: false, error: false })
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
    expect(composer.querySelector('.composer-artifact-strip')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Contexto ZIP' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Prompt' }).getAttribute('aria-pressed')).toBe('true')
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
