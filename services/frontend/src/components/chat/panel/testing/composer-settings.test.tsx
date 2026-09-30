import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { panelRef, typeInComposer, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('moves execution and automation choices into compact composer icons', () => {
    const onExecutionMode = vi.fn()
    const onAutomationMode = vi.fn()
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} executionMode="protected" automationMode="manual" onExecutionMode={onExecutionMode} onAutomationMode={onAutomationMode} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('form')!
    expect(composer.querySelector('[aria-label="Proteção de execução"]')).toBeTruthy()
    expect(composer.querySelector('[aria-label="Automação de execução"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Protected' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Unprotected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto + Aprovar' }))
    expect(onExecutionMode).toHaveBeenCalledWith('unprotected')
    expect(onExecutionMode).toHaveBeenCalledWith('full')
    expect(onAutomationMode).toHaveBeenCalledWith('auto')
    expect(onAutomationMode).toHaveBeenCalledWith('auto_approve')
  })

it('keeps provider reasoning separate from the autonomous attempt budget', () => {
    const onReasoningEffort = vi.fn()
    render(
      <ChatPanel session={{ ...session, effort_level: 'ultra', reasoning_effort: 'medium' }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onReasoningEffort={onReasoningEffort} {...chatActions} />,
    )
    const picker = screen.getByLabelText('Esforço de raciocínio') as HTMLSelectElement
    expect(picker.value).toBe('medium')
    fireEvent.change(picker, { target: { value: 'instant' } })
    expect(onReasoningEffort).toHaveBeenCalledWith('instant')
    expect((screen.getByLabelText('Nível de esforço') as HTMLSelectElement).value).toBe('ultra')
  })

it('offers no tunnel control because a request never depends on a tunnel', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.queryByRole('button', { name: 'Túneis do ChatGPT' })).toBeNull()
    expect(screen.queryByText('Canais remotos')).toBeNull()
  })

it('keeps Unprotected disabled in the composer during self-evolution', () => {
    render(
      <ChatPanel session={{ ...session, self_evolution: true }} items={[]} chats={[]} activeChatId="chat-1" busy={false} executionMode="protected" automationMode="auto_approve" onExecutionMode={vi.fn()} onAutomationMode={vi.fn()} onSend={async () => undefined} {...chatActions} />,
    )
    expect((screen.getByRole('button', { name: 'Unprotected' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Auto + Aprovar' }).getAttribute('aria-pressed')).toBe('true')
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

it('resizes the composer from its top border instead of the native bottom-right handle', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-resize" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const handle = screen.getByRole('separator', { name: 'Redimensionar altura do chat composer' })
    vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, right: 600, bottom: 180, left: 0, width: 600, height: 180, toJSON: () => ({}) })

    const pointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY })
      Object.defineProperty(event, 'pointerId', { configurable: true, value: 7 })
      return event
    }

    fireEvent(handle, pointerEvent('pointerdown', 500))
    fireEvent(handle, pointerEvent('pointermove', 420))
    expect(composer.style.height).toBe('260px')

    fireEvent(handle, pointerEvent('pointermove', 900))
    expect(composer.style.height).toBe('180px')
    fireEvent(handle, pointerEvent('pointerup', 900))
  })

it('grows the composer as multiline content expands, bounded by the configured maximum', async () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="chat-growth" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const scrollArea = composer.querySelector('.composer-scroll-area') as HTMLElement
    const footer = composer.querySelector('.composer-footer') as HTMLElement
    Object.defineProperty(scrollArea, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(footer, 'offsetHeight', { configurable: true, value: 52 })
    Object.defineProperty(composer, 'offsetHeight', { configurable: true, value: 156 })
    Object.defineProperty(composer, 'clientHeight', { configurable: true, value: 154 })

    typeInComposer(ref, 'linha 1\nlinha 2\nlinha 3\nlinha 4', 'linha 1\nlinha 2\nlinha 3\nlinha 4'.length)

    await waitFor(() => expect(composer.style.height).toBe('420px'))
  })
})
