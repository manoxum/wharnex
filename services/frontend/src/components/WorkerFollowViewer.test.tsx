import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerFollowViewer } from './WorkerFollowViewer'

const capturedAt = '2026-09-27T15:00:00Z'

function installBridge() {
  const agents = {
    snapshot: vi.fn(async (agentId: string) => ({ agentId, dataUrl: 'data:image/png;base64,AA==', capturedAt })),
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a running Worker without opening or resizing its native browser', async () => {
    const agents = installBridge()
    const view = render(<WorkerFollowViewer agentId="worker-1" onStop={() => undefined}/> )
    expect(await screen.findByRole('img', { name: /Navegador de worker-1/ })).toBeTruthy()
    expect(agents.snapshot).toHaveBeenCalledWith('worker-1')
    expect(agents.openInteraction).not.toHaveBeenCalled()
    expect(agents.setInteractionBounds).not.toHaveBeenCalled()
    expect(agents.closeInteraction).not.toHaveBeenCalled()
    view.unmount()
  })

  it('keeps refreshing frames until the operator stops following', async () => {
    const agents = installBridge()
    vi.useFakeTimers()
    const view = render(<WorkerFollowViewer agentId="worker-2" onStop={() => undefined}/> )
    await act(async () => { await Promise.resolve() })
    expect(agents.snapshot).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(agents.snapshot).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(agents.snapshot).toHaveBeenCalledTimes(2)
  })

  it('retries a failed frame without closing the viewer', async () => {
    const agents = installBridge()
    agents.snapshot.mockRejectedValueOnce(new Error('frame unavailable'))
    render(<WorkerFollowViewer agentId="worker-3" onStop={() => undefined}/> )
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('A tentar novamente'))
    expect(agents.openInteraction).not.toHaveBeenCalled()
  })
})
