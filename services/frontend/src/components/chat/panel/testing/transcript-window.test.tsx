import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('renders only the latest transcript window and loads older messages when scrolling upward', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `history-${index + 1}`, role: 'user' as const, text: `mensagem ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="history-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(screen.queryByText('mensagem 1')).toBeNull()
    expect(screen.getByText('mensagem 25')).toBeTruthy()
    expect(screen.getByText('5 mensagem(ns) anterior(es)')).toBeTruthy()

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 0
    fireEvent.scroll(stream)

    await waitFor(() => expect(screen.getByText('mensagem 1')).toBeTruthy())
    expect(screen.queryByText('5 mensagem(ns) anterior(es)')).toBeNull()
  })

it('keeps a bounded transcript DOM while following a long chat scrollbar', async () => {
    const items = Array.from({ length: 120 }, (_, index) => ({ id: `long-${index + 1}`, role: 'user' as const, text: `longa mensagem ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="long-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 21600 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 360 })

    stream.scrollTop = 0
    fireEvent.scroll(stream)
    await waitFor(() => expect(screen.getByText('longa mensagem 1')).toBeTruthy())

    stream.scrollTop = 30 * 180
    fireEvent.scroll(stream)
    await waitFor(() => expect(screen.getByText('longa mensagem 31')).toBeTruthy())

    expect(view.container.querySelectorAll('.chat-stream article.message').length).toBeLessThanOrEqual(60)
    expect(screen.queryByText('longa mensagem 120')).toBeNull()
    expect(screen.getByRole('button', { name: 'Carregar mensagens mais recentes' })).toBeTruthy()
  })

it('keeps the transcript content aligned with a drag to the beginning of a long scroll', async () => {
    const items = Array.from({ length: 120 }, (_, index) => ({ id: `scroll-alignment-${index + 1}`, role: 'user' as const, text: `scroll alinhado ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="scroll-alignment" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 21600 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 360 })
    stream.scrollTop = 0
    fireEvent.scroll(stream)

    await waitFor(() => expect(screen.getByText('scroll alinhado 1')).toBeTruthy())
    expect(view.container.querySelectorAll('.chat-stream article.message').length).toBeLessThanOrEqual(60)
  })

it('defers rich offscreen transcript entries until they approach the scroll viewport', async () => {
    const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = []
    class TestIntersectionObserver {
      readonly targets: Element[] = []
      constructor(readonly callback: IntersectionObserverCallback) { observers.push(this) }
      observe(target: Element) { this.targets.push(target) }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `deferred-rich-${index + 1}`, role: 'harness' as const, source: 'chatgpt' as const,
      text: `## Markdown pesado ${index + 1}\n\n${'conteúdo renderizado '.repeat(300)}`,
    }))
    render(<ChatPanel session={session} items={items} chats={[]} activeChatId="deferred-rich" busy={false} onSend={async () => undefined} {...chatActions} />)

    expect(screen.queryByText(/Markdown pesado 1/)).toBeNull()
    expect(screen.getByText(/Markdown pesado 8/)).toBeTruthy()
    expect(observers).toHaveLength(4)

    observers[0].callback([{ isIntersecting: true, target: observers[0].targets[0] } as IntersectionObserverEntry], {} as IntersectionObserver)
    await waitFor(() => expect(screen.getByText(/Markdown pesado 1/)).toBeTruthy())
  })
})
