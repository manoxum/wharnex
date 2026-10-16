import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { panelRef, composerText, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('adds files pasted from the operating-system clipboard', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    const file = new File(['image'], 'captura.png', { type: 'image/png' })
    const composer = view.container.querySelector('.composer-rich-editor')!
    fireEvent.paste(composer, { clipboardData: { files: [file], items: [] } })
    expect(view.container.textContent).toContain('captura.png')
    expect(composerText(ref)).toBe('')
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

it('turns a large plain-text paste into a prompt-scoped attachment', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="large-paste" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer-rich-editor')!
    const text = 'x'.repeat(6000)
    fireEvent.paste(composer, { clipboardData: { files: [], items: [], getData: (kind: string) => kind === 'text/plain' ? text : '' } })
    expect(view.container.textContent).toContain('Prompt 01 · Pasted Text 01.txt')
    expect(composerText(ref)).toBe('')
  })

it('requires explicit confirmation for a prepared ChatGPT draft', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} preparedAttachmentCount={2} onSend={async () => undefined} onConfirmPrepared={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByText('Preparação enviada ao ChatGPT')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirmar e enviar/ })).toBeTruthy()
  })

it('offers a retry when ChatGPT could not receive a prepared prompt', async () => {
    const onRetryPreparedDelivery = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} failedPromptDelivery={{ kind: 'retry', requestId: 'req-retry' }} onSend={async () => undefined} onRetryPreparedDelivery={onRetryPreparedDelivery} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar entregar novamente' }))
    await waitFor(() => expect(onRetryPreparedDelivery).toHaveBeenCalledWith('req-retry'))
  })

it('labels the retry as a post-attention retry when the ChatGPT composer needs human attention', async () => {
    const onRetryPreparedDelivery = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} failedPromptDelivery={{ kind: 'attention', requestId: 'req-attention' }} onSend={async () => undefined} onRetryPreparedDelivery={onRetryPreparedDelivery} {...chatActions} />,
    )
    expect(screen.getByText('Ação necessária no ChatGPT')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar depois de resolver' }))
    await waitFor(() => expect(onRetryPreparedDelivery).toHaveBeenCalledWith('req-attention'))
  })

it('shows remote context generation progress and allows cancelling the in-flight bundle preparation', async () => {
    const onCancelPendingRequest = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="progress-test" busy={true} transportProgress="A gerar o ZIP enriquecido e a publicá-lo no provider…" transportRequestId="req-progress" onCancelPendingRequest={onCancelPendingRequest} onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByRole('status').textContent).toContain('A preparar rotas remotas')
    expect(screen.getByRole('status').textContent).toContain('provider')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar preparação do bundle' }))
    await waitFor(() => expect(onCancelPendingRequest).toHaveBeenCalledWith('req-progress'))
  })

it('keeps system artifact selectors inside the Wharnex composer and marks automatic payloads', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} artifactSelection={{ context: true, prompt: true, result: false, error: false }} artifactRequired={{ context: true }} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('form')!
    expect(composer.querySelector('.composer-action-row')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Contexto e ferramentas' }))
    expect(screen.getByRole('button', { name: 'Contexto ZIP' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Prompt' }).getAttribute('aria-pressed')).toBe('true')
    expect(composer.querySelector('.composer-reference-thumbnail.transport')).toBeNull()
  })
})
