import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerFollowViewer } from './WorkerFollowViewer'

function installBridge() {
  const agents = {
    openMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, alreadyOpen: false })),
    closeMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
    openInteraction: vi.fn(),
    setInteractionBounds: vi.fn(),
    closeInteraction: vi.fn(),
  }
  window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
  return agents
}

describe('WorkerFollowViewer', () => {
  afterEach(() => {
    delete window.wharnessDesktop
    vi.restoreAllMocks()
  })

  it('opens the same Worker in a full-size window without using the narrow interaction pane', async () => {
    const agents = installBridge()
    const stop = vi.fn()
    render(<WorkerFollowViewer agentId="worker-1" onStop={stop}/>)
    await waitFor(() => expect(agents.openMonitor).toHaveBeenCalledWith('worker-1'))
    expect(await screen.findByText(/Janela do Worker aberta/)).toBeTruthy()
    expect(agents.openInteraction).not.toHaveBeenCalled()
    expect(agents.setInteractionBounds).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Parar de seguir' }))
    await waitFor(() => expect(agents.closeMonitor).toHaveBeenCalledWith('worker-1'))
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('offers to reopen a monitor window after a failed open', async () => {
    const agents = installBridge()
    agents.openMonitor.mockRejectedValueOnce(new Error('window unavailable'))
    render(<WorkerFollowViewer agentId="worker-3" onStop={() => undefined}/> )
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Não foi possível abrir'))
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir janela' }))
    await waitFor(() => expect(agents.openMonitor).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Janela do Worker aberta/)).toBeTruthy()
  })
})
