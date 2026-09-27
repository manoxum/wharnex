import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'
import { bridge, props } from './chatGPTDesktopPaneTestFixtures'

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }

function followBridge() {
  const desktop = bridge()
  desktop.agents.snapshot = vi.fn(async (agentId: string) => ({ agentId, dataUrl: 'data:image/png;base64,AA==', capturedAt: '2026-09-27T15:00:00Z' }))
  window.wharnessDesktop = desktop
  return desktop
}

describe('ChatGPTDesktopPane Worker follow', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); window.localStorage.clear() })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('follows a busy Worker in Engine without resizing its browser and restores the Supervisor on exit', async () => {
    const desktop = followBridge()
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())

    act(() => window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId: 'worker-2' } })))
    expect(await screen.findByText('Seguindo Worker 2')).toBeTruthy()
    await waitFor(() => expect(desktop.agents.snapshot).toHaveBeenCalledWith('worker-2'))
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalledWith('chat-1'))
    expect(desktop.agents.openInteraction).not.toHaveBeenCalled()
    expect(desktop.agents.setInteractionBounds).not.toHaveBeenCalled()

    const blocker = document.createElement('div')
    blocker.setAttribute('data-chatgpt-overlay-blocker', 'true')
    document.body.appendChild(blocker)
    await waitFor(() => expect(screen.queryByText('Seguindo Worker 2')).toBeNull())
    blocker.remove()
    expect(await screen.findByText('Seguindo Worker 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Parar de seguir' }))
    expect(desktop.agents.closeInteraction).not.toHaveBeenCalled()
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
  })

  it('keeps Worker DevTools and conversation link tied to the selected instance', async () => {
    const desktop = followBridge()
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)
    const selector = await screen.findByRole('combobox', { name: 'Instância do Engine' })
    fireEvent.change(selector, { target: { value: 'worker-2' } })
    await waitFor(() => expect(desktop.agents.snapshot).toHaveBeenCalledWith('worker-2'))

    fireEvent.click(screen.getByRole('button', { name: 'Abrir DevTools da instância atual' }))
    await waitFor(() => expect(desktop.agents.openDevTools).toHaveBeenCalledWith('worker-2'))
    expect(desktop.chatgpt.openDevTools).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link da conversa visível' }))
    await waitFor(() => expect(desktop.clipboard.writeText).toHaveBeenCalledWith('https://chatgpt.com/c/worker'))

    fireEvent.change(selector, { target: { value: '' } })
    expect(desktop.agents.closeInteraction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir DevTools da instância atual' }))
    await waitFor(() => expect(desktop.chatgpt.openDevTools).toHaveBeenCalledWith('chat-1'))
  })
})
