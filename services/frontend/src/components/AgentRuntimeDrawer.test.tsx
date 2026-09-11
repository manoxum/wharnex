import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeDrawer } from './AgentRuntimeDrawer'

function runtime(desiredWorkers = 3): DesktopAgentRuntimeState {
  return {
    instance_id: 'desktop-test',
    desired_workers: desiredWorkers,
    limits: { min_workers: 1, max_workers: 6, supervisors: 1 },
    agents: [
      { id: 'supervisor', label: 'Supervisor', role: 'supervisor', status: 'idle', draining: false, chat_id: 'chat-human', error: '', browser: { available: true, web_contents_id: 10, url: 'https://chatgpt.com/c/human', title: 'Chat humano', loading: false } },
      { id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', draining: false, chat_id: 'chat-1', task: { task_id: 'task-1', type: 'AWAIT_RESPONSE', chat_id: 'chat-1', request_id: 'req-1', status: 'RUNNING' }, error: '', browser: { available: true, web_contents_id: 11, url: 'https://chatgpt.com/c/worker', title: 'Chat worker', loading: false } },
    ],
  }
}

describe('AgentRuntimeDrawer', () => {
  afterEach(() => {
    delete window.wharnessDesktop
    vi.restoreAllMocks()
  })

  it('lists runtime instances, exposes task details and scales workers', async () => {
    const setWorkerCount = vi.fn(async (count: number) => runtime(count))
    window.wharnessDesktop = {
      agents: {
        state: vi.fn(async () => runtime()),
        setWorkerCount,
        snapshot: vi.fn(async () => ({ agentId: 'worker-1', dataUrl: 'data:image/png;base64,AA==', capturedAt: '2026-09-10T23:00:00Z' })),
        onState: vi.fn(() => () => undefined),
      },
    } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    expect(await screen.findByText('Worker 1')).toBeTruthy()
    fireEvent.click(screen.getByText('Worker 1'))
    expect(screen.getByText(/AWAIT_RESPONSE · task-1/)).toBeTruthy()
    expect(screen.getByText('WebContents #11')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar workers' }))
    await waitFor(() => expect(setWorkerCount).toHaveBeenCalledWith(4))
  })

  it('captures a selected browser only on explicit user action', async () => {
    const snapshot = vi.fn(async () => ({ agentId: 'supervisor', dataUrl: 'data:image/png;base64,AA==', capturedAt: '2026-09-10T23:00:00Z' }))
    window.wharnessDesktop = {
      agents: { state: vi.fn(async () => runtime()), setWorkerCount: vi.fn(), snapshot, onState: vi.fn(() => () => undefined) },
    } as unknown as WharnessDesktopBridge

    render(<AgentRuntimeDrawer onClose={() => undefined} />)
    const button = await screen.findByRole('button', { name: /Ver instância do navegador/ })
    expect(snapshot).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(snapshot).toHaveBeenCalledWith('supervisor'))
    expect(await screen.findByRole('img', { name: /Captura do navegador de Supervisor/ })).toBeTruthy()
  })
})
