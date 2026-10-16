import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('exposes the project knowledge toggle and marks only the active state', async () => {
    const onKnowledgeSharing = vi.fn()
    const view = render(
      <ChatPanel session={{ ...session, knowledge_sharing_enabled: false }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onKnowledgeSharing={onKnowledgeSharing} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Contexto e ferramentas' }))
    let button = screen.getByRole('button', { name: 'Conhecimento do projeto' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.querySelector('svg')).toBeTruthy()
    expect(button.textContent).toContain('Conhecimento desligado')
    fireEvent.click(button)
    await waitFor(() => expect(onKnowledgeSharing).toHaveBeenCalledWith(true))

    view.rerender(
      <ChatPanel session={{ ...session, knowledge_sharing_enabled: true }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onKnowledgeSharing={onKnowledgeSharing} {...chatActions} />,
    )
    button = screen.getByRole('button', { name: 'Conhecimento do projeto' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toContain('Conhecimento ligado')
  })

it('renders the new-chat control as an icon-only plus button', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const button = screen.getByRole('button', { name: 'Novo chat' })
    expect(button.textContent).toBe('')
    expect(button.querySelector('svg')).toBeTruthy()
  })

it('renders Harness responses as sanitized Markdown instead of raw markdown text', () => {
    render(
      <ChatPanel session={session} items={[{ id: 'md-1', role: 'harness', text: '## Prioridade\n\nA funcionalidade **Perfil Inteligente** é a primeira recomendação.' }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Prioridade' })).toBeTruthy()
    expect(screen.getByText('Perfil Inteligente').tagName).toBe('STRONG')
    expect(screen.queryByText('**Perfil Inteligente**')).toBeNull()
  })

it('bounds long Markdown DOM until the operator expands the full response', () => {
    const longBody = `## Resultado\n\n${'Detalhe operacional importante. '.repeat(70)}\n\nFULL_MARKDOWN_TAIL`
    render(
      <ChatPanel session={session} items={[{ id: 'md-long', role: 'harness', source: 'chatgpt', text: longBody }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const toggle = screen.getByRole('button', { name: 'Expandir conteúdo' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.chat-markdown-disclosure.collapsible:not(.expanded)')).toBeTruthy()
    expect(screen.queryByText('FULL_MARKDOWN_TAIL')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Mostrar menos' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.chat-markdown-disclosure.expanded')).toBeTruthy()
    expect(screen.getByText('FULL_MARKDOWN_TAIL')).toBeTruthy()
  })

it('renders submitted composer directives as read-only chips in the user timeline', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const prompt = 'Revê @{[file]src/App.tsx} e destaca @{[see]file|src/App.tsx}; mantém @file:rascunho como texto.'
    const view = render(
      <ChatPanel session={session} items={[{ id: 'directive-timeline', role: 'user', text: prompt }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const chips = view.container.querySelectorAll('.chat-prompt-directive')
    expect(chips.length).toBe(2)
    expect(chips[0].getAttribute('data-chat-prompt-directive')).toBe('file')
    expect(chips[0].getAttribute('title')).toBe('@{[file]src/App.tsx}')
    expect(chips[0].textContent).toContain('App.tsx')
    expect(chips[1].getAttribute('data-chat-prompt-directive')).toBe('see')
    expect(chips[1].getAttribute('title')).toBe('@{[see]file|src/App.tsx}')
    expect(view.container.querySelector('.chat-prompt-window')?.textContent).toContain('@file:rascunho como texto.')

    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensagem' }))
    expect(writeText).toHaveBeenCalledWith(prompt)
  })

it('truncates very large user prompts until the operator expands them', () => {
    const longPrompt = `Primeira linha do prompt\n${'contexto muito grande '.repeat(90)}\nFULL_PROMPT_TAIL`
    render(
      <ChatPanel session={session} items={[{ id: 'user-prompt-long', role: 'user', text: longPrompt }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const toggle = screen.getByRole('button', { name: 'Expandir prompt' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.chat-prompt-disclosure.collapsible:not(.expanded)')).toBeTruthy()
    expect(screen.queryByText(/FULL_PROMPT_TAIL/)).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Mostrar menos' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/FULL_PROMPT_TAIL/)).toBeTruthy()
  })

it('coalesces rapid transcript scroll window updates to one animation frame', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const items = Array.from({ length: 120 }, (_, index) => ({ id: `scroll-frame-${index + 1}`, role: 'user' as const, text: `mensagem frame ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="scroll-frame-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 21600 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 360 })

    stream.scrollTop = 10 * 180
    fireEvent.scroll(stream)
    stream.scrollTop = 20 * 180
    fireEvent.scroll(stream)
    stream.scrollTop = 30 * 180
    fireEvent.scroll(stream)

    expect(frames).toHaveLength(1)
    await act(async () => { frames.shift()?.(performance.now()) })
    await waitFor(() => expect(screen.getByText('mensagem frame 31')).toBeTruthy())
  })

it('shows only the latest consecutive WHX notice until the ellipsis control is expanded', () => {
    const view = render(
      <ChatPanel session={session} items={[
        { id: 'whx-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Primeira atualização.' },
        { id: 'whx-2', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Segunda atualização.' },
        { id: 'whx-3', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Última atualização.' },
      ]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(view.container.querySelectorAll('.chat-notice')).toHaveLength(1)
    expect(screen.getAllByText('Última atualização.')).toHaveLength(1)
    const toggle = screen.getByRole('button', { name: 'Mostrar 2 notificações WHX anteriores' })
    fireEvent.click(toggle)
    expect(view.container.querySelectorAll('.chat-notice')).toHaveLength(3)
    expect(screen.getAllByText('Primeira atualização.')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Ocultar notificações WHX anteriores' })).toBeTruthy()
  })

it('defers rich notice Markdown until the native disclosure is opened', () => {
    const noticeText = `${'Atualização extensa para diagnóstico. '.repeat(60)}\n\n**FULL_NOTICE_TAIL**`
    const view = render(
      <ChatPanel session={session} items={[{ id: 'notice-heavy', role: 'harness', source: 'wharness', presentation: 'notice', text: noticeText }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(view.container.querySelector('.chat-markdown-disclosure')).toBeNull()
    const summary = view.container.querySelector<HTMLElement>('.chat-notice > summary')
    expect(summary).toBeTruthy()
    fireEvent.click(summary!)
    expect(view.container.querySelector('.chat-markdown-disclosure')).toBeTruthy()
    expect(screen.queryByText('FULL_NOTICE_TAIL')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir conteúdo' }))
    expect(screen.getByText('FULL_NOTICE_TAIL')).toBeTruthy()
  })
})
