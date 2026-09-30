import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTDesktopPane } from './ChatGPTDesktopPane'
import { bridge, props } from './chatGPTDesktopPaneTestFixtures'

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }

function followBridge() {
  const desktop = bridge()
  window.wharnessDesktop = desktop
  return desktop
}

describe('ChatGPTDesktopPane Worker follow', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); window.localStorage.clear() })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('embeds a busy Worker in Engine and restores the Supervisor on exit', async () => {
    const desktop = followBridge()
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())

    act(() => window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId: 'worker-2' } })))
    expect(await screen.findByText('Seguindo Worker 2')).toBeTruthy()
    await waitFor(() => expect(desktop.agents.openInteraction).toHaveBeenCalledWith('worker-2', expect.objectContaining({ width: 1, height: 1 })))
    await waitFor(() => expect(desktop.agents.setInteractionBounds).toHaveBeenCalledWith('worker-2', expect.objectContaining({ width: 1, height: 1 })))
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalledWith('chat-1'))
    expect(desktop.agents.openMonitor).not.toHaveBeenCalled()

    const blocker = document.createElement('div')
    blocker.setAttribute('data-chatgpt-overlay-blocker', 'true')
    document.body.appendChild(blocker)
    await waitFor(() => expect(desktop.agents.closeInteraction).toHaveBeenCalledWith('worker-2'))
    expect(screen.getByText('ChatGPT preservado')).toBeTruthy()
    blocker.remove()
    await waitFor(() => expect(screen.getByText('Seguindo Worker 2')).toBeTruthy())
    await waitFor(() => expect(vi.mocked(desktop.agents.openInteraction).mock.calls.length).toBeGreaterThan(1))

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao Supervisor' }))
    await waitFor(() => expect(desktop.agents.closeInteraction).toHaveBeenCalledWith('worker-2'))
    expect(desktop.agents.closeMonitor).not.toHaveBeenCalled()
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalled())
  })

  it('keeps the Worker selected while an overlay blocks the embedded Engine surface', async () => {
    const desktop = followBridge()
    const blocker = document.createElement('div')
    blocker.setAttribute('data-chatgpt-overlay-blocker', 'true')
    document.body.appendChild(blocker)
    try {
      render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)
      await screen.findByText('ChatGPT preservado')
      act(() => window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId: 'worker-2' } })))
      await waitFor(() => expect((screen.getByRole('combobox', { name: 'Instância do Engine' }) as HTMLSelectElement).value).toBe('worker-2'))
      expect(desktop.agents.openMonitor).not.toHaveBeenCalled()
      expect(desktop.agents.openInteraction).not.toHaveBeenCalled()
      blocker.remove()
      await waitFor(() => expect(desktop.agents.openInteraction).toHaveBeenCalledWith('worker-2', expect.any(Object)))
    } finally {
      blocker.remove()
    }
  })

  it('clears the embedded Worker when Desktop reports that the instance disappeared', async () => {
    const desktop = followBridge()
    const listeners: Array<(state: DesktopAgentRuntimeState) => void> = []
    vi.mocked(desktop.agents.onState).mockImplementation((listener) => { listeners.push(listener); return () => undefined })
    const runtime = await desktop.agents.state()
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)
    act(() => window.dispatchEvent(new CustomEvent('wharnex:agent-follow', { detail: { agentId: 'worker-2' } })))
    await waitFor(() => expect(desktop.agents.openInteraction).toHaveBeenCalledWith('worker-2', expect.any(Object)))
    expect(screen.getByText('Seguindo Worker 2')).toBeTruthy()

    const withoutWorker = { ...runtime, agents: runtime.agents.filter((agent) => agent.id !== 'worker-2') }
    act(() => listeners.forEach((listener) => listener(withoutWorker)))
    await waitFor(() => expect(screen.queryByText('Seguindo Worker 2')).toBeNull())
    expect(desktop.agents.closeInteraction).toHaveBeenCalledWith('worker-2')
  })

  it('keeps Worker DevTools and conversation link tied to the selected embedded instance', async () => {
    const desktop = followBridge()
    render(<ChatGPTDesktopPane {...props} chatgptUrl="https://chatgpt.com/c/right" />)
    const selector = await screen.findByRole('combobox', { name: 'Instância do Engine' })
    fireEvent.change(selector, { target: { value: 'worker-2' } })
    await waitFor(() => expect(desktop.agents.openInteraction).toHaveBeenCalledWith('worker-2', expect.any(Object)))
    expect(desktop.agents.openMonitor).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir DevTools da instância atual' }))
    await waitFor(() => expect(desktop.agents.openDevTools).toHaveBeenCalledWith('worker-2'))
    expect(desktop.chatgpt.openDevTools).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link da conversa visível' }))
    await waitFor(() => expect(desktop.clipboard.writeText).toHaveBeenCalledWith('https://chatgpt.com/c/worker'))

    fireEvent.change(selector, { target: { value: '' } })
    await waitFor(() => expect(desktop.agents.closeInteraction).toHaveBeenCalledWith('worker-2'))
    expect(desktop.agents.closeMonitor).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir DevTools da instância atual' }))
    await waitFor(() => expect(desktop.chatgpt.openDevTools).toHaveBeenCalledWith('chat-1'))
  })
})
