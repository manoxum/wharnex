import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerFollowViewer } from './WorkerFollowViewer'

function installBridge() {
  let publish: ((state: DesktopAgentRuntimeState) => void) | undefined
  const agents = {
    openMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, alreadyOpen: false })),
    onState: vi.fn((listener: (state: DesktopAgentRuntimeState) => void) => { publish = listener; return () => undefined }),
    closeMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
    openInteraction: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    setInteractionBounds: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    closeInteraction: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
  }
  window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
  return { agents, publish: (state: DesktopAgentRuntimeState) => publish?.(state) }
}

describe('WorkerFollowViewer', () => {
  afterEach(() => {
    delete window.wharnessDesktop
    vi.restoreAllMocks()
  })

  it('embeds the Worker interaction and keeps its native bounds synchronized', async () => {
    const { agents } = installBridge()
    const stop = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300, toJSON: () => ({}) } as DOMRect)
    render(<WorkerFollowViewer agentId="worker-1" onStop={stop}/>)

    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-1', { x: 10, y: 20, width: 400, height: 300 }))
    expect(await screen.findByText(/Instância incorporada/)).toBeTruthy()
    expect(agents.openMonitor).not.toHaveBeenCalled()
    await waitFor(() => expect(agents.setInteractionBounds).toHaveBeenCalledWith('worker-1', { x: 10, y: 20, width: 400, height: 300 }))

    const beforeScroll = agents.setInteractionBounds.mock.calls.length
    fireEvent.scroll(window)
    await waitFor(() => expect(agents.setInteractionBounds.mock.calls.length).toBeGreaterThan(beforeScroll))

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao Supervisor' }))
    await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-1'))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(agents.closeMonitor).not.toHaveBeenCalled()
  })

  it('cleans up a failed interaction before allowing a retry', async () => {
    const { agents } = installBridge()
    agents.openInteraction.mockRejectedValueOnce(new Error('interaction unavailable'))
    render(<WorkerFollowViewer agentId="worker-3" onStop={() => undefined}/> )

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Não foi possível abrir'))
    expect(agents.closeInteraction).toHaveBeenCalledWith('worker-3')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Instância incorporada/)).toBeTruthy()
    expect(agents.openMonitor).not.toHaveBeenCalled()
  })

  it('stops following when the Worker disappears from Desktop state', async () => {
    const { agents, publish } = installBridge()
    const stop = vi.fn()
    render(<WorkerFollowViewer agentId="worker-2" onStop={stop}/>)
    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalled())

    publish({ agents: [] } as unknown as DesktopAgentRuntimeState)
    await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-2'))
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('closes the embedded interaction when the viewer unmounts', async () => {
    const { agents } = installBridge()
    const view = render(<WorkerFollowViewer agentId="worker-4" onStop={() => undefined}/>)
    await waitFor(() => expect(agents.openInteraction).toHaveBeenCalled())

    view.unmount()
    await waitFor(() => expect(agents.closeInteraction).toHaveBeenCalledWith('worker-4'))
  })
})
