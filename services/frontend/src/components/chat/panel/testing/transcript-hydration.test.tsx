import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('hydrates admitted older transcript content one scheduled item at a time behind skeletons', async () => {
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
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const items = Array.from({ length: 8 }, (_, index) => ({ id: `staged-${index + 1}`, role: 'user' as const, text: `conteúdo faseado ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="staged-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(screen.getByText('conteúdo faseado 8')).toBeTruthy()
    expect(screen.getByText('conteúdo faseado 5')).toBeTruthy()
    expect(screen.queryByText('conteúdo faseado 1')).toBeNull()
    expect(view.container.querySelectorAll('.chat-entry-skeleton')).toHaveLength(4)
    expect(observers).toHaveLength(4)
    expect(frames).toHaveLength(0)

    await act(async () => {
      observers[0].callback([{ isIntersecting: true, target: observers[0].targets[0] } as IntersectionObserverEntry], {} as IntersectionObserver)
      observers[1].callback([{ isIntersecting: true, target: observers[1].targets[0] } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(frames).toHaveLength(1)

    await act(async () => { frames.shift()?.(performance.now()) })
    expect(screen.getByText('conteúdo faseado 2')).toBeTruthy()
    expect(screen.queryByText('conteúdo faseado 1')).toBeNull()
    expect(view.container.querySelectorAll('.chat-entry-skeleton')).toHaveLength(3)

    await act(async () => { frames.shift()?.(performance.now()) })
    expect(screen.getByText('conteúdo faseado 1')).toBeTruthy()
  })

it('restores independent viewport positions and loaded history when switching chats', async () => {
    const chatAItems = Array.from({ length: 45 }, (_, index) => ({ id: `chat-a-${index + 1}`, role: 'user' as const, text: `chat A mensagem ${index + 1}` }))
    const chatBItems = Array.from({ length: 12 }, (_, index) => ({ id: `chat-b-${index + 1}`, role: 'user' as const, text: `chat B mensagem ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={chatAItems} chats={[]} activeChatId="chat-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 0
    fireEvent.scroll(stream)

    await waitFor(() => expect(screen.getByText('chat A mensagem 1')).toBeTruthy())

    stream.scrollTop = 320
    fireEvent.scroll(stream)
    view.rerender(
      <ChatPanel session={session} items={chatBItems} chats={[]} activeChatId="chat-b" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    stream.scrollTop = 140
    fireEvent.scroll(stream)
    const chatAWithNewActivity = [...chatAItems, { id: 'chat-a-46', role: 'harness' as const, text: 'chat A mensagem 46' }]
    view.rerender(
      <ChatPanel session={session} items={chatAWithNewActivity} chats={[]} activeChatId="chat-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(stream.scrollTop).toBe(320)
    expect(screen.getByText('chat A mensagem 6')).toBeTruthy()
    expect(screen.getByText('chat A mensagem 46')).toBeTruthy()

    view.rerender(
      <ChatPanel session={session} items={chatBItems} chats={[]} activeChatId="chat-b" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(stream.scrollTop).toBe(140)
  })

it('returns to the newest transcript window when a chat was left following the tail', () => {
    const scrollIntoView = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const chatAItems = Array.from({ length: 25 }, (_, index) => ({ id: `tail-a-${index + 1}`, role: 'user' as const, text: `tail A mensagem ${index + 1}` }))
    const chatBItems = [{ id: 'tail-b-1', role: 'user' as const, text: 'tail B mensagem 1' }]
    const view = render(
      <ChatPanel session={session} items={chatAItems} chats={[]} activeChatId="tail-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 600
    fireEvent.scroll(stream)

    view.rerender(
      <ChatPanel session={session} items={chatBItems} chats={[]} activeChatId="tail-b" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const chatAWithNewActivity = [...chatAItems, { id: 'tail-a-26', role: 'harness' as const, text: 'tail A mensagem 26' }]
    view.rerender(
      <ChatPanel session={session} items={chatAWithNewActivity} chats={[]} activeChatId="tail-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(screen.queryByText('tail A mensagem 6')).toBeNull()
    expect(screen.getByText('tail A mensagem 26')).toBeTruthy()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'end' })
  })
})
