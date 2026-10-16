import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeDrawer } from '../AgentRuntimeDrawer'

afterEach(() => {
  delete window.wharnessDesktop
  vi.restoreAllMocks()
})

describe('AgentRuntimeDrawer project privacy', () => {
  it('shows foreign project occupancy without exposing its task or conversation details', async () => {
    const task = {
      task_id: 'private-task-51', type: 'BOT_WRITE', chat_id: 'private-chat-51', project_id: '/home/op/alpha',
      request_id: 'private-request-51', root_request_id: 'private-root-51', conversation_id: 'private-conversation-51',
      status: 'RUNNING', attempt: 1, max_attempts: 30, assigned_worker: '', keep_flowing: false,
      lease_expires_at: '', not_before: '', last_error: 'private failure', created_at: '', updated_at: '',
    }
    const foreignAgent = {
      id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', draining: false, occupied: true,
      chat_id: 'private-chat-51', project_id: '/home/op/alpha', task, error: '', loop_active: true,
      browser: { available: true, web_contents_id: 11, os_process_id: 2011, url: 'https://chatgpt.com/c/private-conversation-51', title: 'private conversation title', loading: false },
      memory: { available: true, rss_bytes: 100 * 1024 * 1024, os_process_id: 2011, shared_process: false },
    }
    const state = {
      instance_id: 'desktop', desired_workers: 1, configured_workers: 1,
      desired_supervisors: 1, configured_supervisors: 1,
      policies: { auto_scale: false, auto_scaled_workers: 0, auto_scaled_supervisors: 0, keep_flowing_global: false },
      scheduler: { running: true }, agents: [foreignAgent],
    } as unknown as DesktopAgentRuntimeState
    window.wharnessDesktop = { agents: { state: vi.fn(async () => state), onState: vi.fn(() => () => undefined) } } as unknown as WharnessDesktopBridge

    const { container } = render(<AgentRuntimeDrawer projectPath="/home/op/beta" onClose={() => undefined}/> )

    expect(await screen.findByText('Outro projeto · alpha')).toBeTruthy()
    expect(screen.getAllByText(/Ocupado noutro projeto/).length).toBeGreaterThan(0)
    expect(screen.getByText('Conversa do projeto alpha')).toBeTruthy()
    for (const privateValue of ['BOT_WRITE', 'private-task-51', 'private-request-51', 'private-conversation-51', 'private failure', 'private conversation title']) {
      expect(screen.queryByText(new RegExp(privateValue))).toBeNull()
    }
    fireEvent.click(container.querySelector('.agent-runtime-list > button')!)
    expect((screen.getByRole('button', { name: 'Trazer o projeto alpha para foco' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
