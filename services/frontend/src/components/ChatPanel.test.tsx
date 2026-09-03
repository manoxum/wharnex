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

describe('ChatPanel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not return scrollIntoView result as an effect cleanup', () => {
    const scrollIntoView = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onNewChat={async () => undefined} onSelectChat={async () => undefined} />,
    )

    expect(scrollIntoView).toHaveBeenCalled()
    expect(() => view.unmount()).not.toThrow()
  })

  it('selects files and submits them with the message', async () => {
    const onSend = vi.fn(async () => undefined)
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={onSend} onNewChat={async () => undefined} onSelectChat={async () => undefined} />,
    )
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['spec'], 'spec.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…'), { target: { value: 'implementar' } })
    fireEvent.submit(view.container.querySelector('form')!)
    expect(onSend).toHaveBeenCalledWith('implementar', [file])
  })

  it('adds files pasted from the operating-system clipboard', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={async () => undefined} onNewChat={async () => undefined} onSelectChat={async () => undefined} />,
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
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} preparedAttachmentCount={2} onSend={async () => undefined} onConfirmPrepared={async () => undefined} onNewChat={async () => undefined} onSelectChat={async () => undefined} />,
    )
    expect(screen.getByText('Preparação enviada ao ChatGPT')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirmar e enviar/ })).toBeTruthy()
  })
})
