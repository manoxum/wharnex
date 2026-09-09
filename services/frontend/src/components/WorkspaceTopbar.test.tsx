import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { WorkspaceTopbar } from './WorkspaceTopbar'

const mocks = vi.hoisted(() => ({
  bundleQuota: vi.fn(async () => ({ window_hours: 3, limit: 80, sent: 12, received: 11, total: 23, warning: false, window_start: '2026-09-09T14:00:00Z', window_end: '2026-09-09T17:00:00Z' })),
}))
vi.mock('../lib/api', () => ({ api: { bundleQuota: mocks.bundleQuota } }))

function session(): Session {
  return {
    id: 'ses-self',
    project_path: '/workspace/wharness',
    execution_mode: 'protected',
    automation_mode: 'auto',
    self_evolution: true,
    state: 'ready',
    created_at: new Date().toISOString(),
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
  }
}

describe('WorkspaceTopbar self-evolution', () => {
  it('marks the workspace without exposing execution choices in the top bar', () => {
    render(<WorkspaceTopbar
      session={session()}
      mode="agent"
      executionMode="protected"
      automationMode="auto"
      busy={false}
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    expect(screen.getByRole('img', { name: 'Auto-evolução ativa' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Automação automática' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'AI manual' })).toBeTruthy()
    expect(screen.getByText('WHX · AUTO-EVOLUÇÃO')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Protected' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unprotected' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manual' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull()
  })
  it('keeps the pending restart visible but blocks activation while another task is active', () => {
    render(<WorkspaceTopbar
      session={session()}
      mode="agent"
      executionMode="protected"
      automationMode="auto"
      restartPending
      restartBlocked
      busy={false}
      onMode={vi.fn()}
      onRestartPending={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    expect((screen.getByRole('button', { name: 'Reinício pendente' }) as HTMLButtonElement).disabled).toBe(true)
  })


  it('shows the global rolling quota even before the current chat has bundles', async () => {
    render(<WorkspaceTopbar
      session={session()}
      mode="agent"
      executionMode="protected"
      automationMode="auto"
      busy={false}
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    expect(await screen.findByText('3H ↑12/80 ↓11')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Estimativa local ChatGPT.*12\/80 enviados.*11 recebidos/i })).toBeTruthy()
  })

  it('refreshes immediately when bundle artifact metadata changes and announces a non-blocking warning', async () => {
    mocks.bundleQuota.mockResolvedValueOnce({ window_hours: 3, limit: 80, sent: 79, received: 78, total: 157, warning: false, window_start: '2026-09-09T14:00:00Z', window_end: '2026-09-09T17:00:00Z' })
    const view = render(<WorkspaceTopbar
      session={session()}
      mode="agent"
      executionMode="protected"
      automationMode="auto"
      busy={false}
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    expect(await screen.findByText('3H ↑79/80 ↓78')).toBeTruthy()

    mocks.bundleQuota.mockResolvedValueOnce({ window_hours: 3, limit: 80, sent: 80, received: 79, total: 159, warning: true, window_start: '2026-09-09T14:00:00Z', window_end: '2026-09-09T17:00:00Z' })
    view.rerender(<WorkspaceTopbar
      session={{ ...session(), artifacts: [{ id: 'bundle-1', request_id: 'req_20260909T170000_1234567890abcdef', direction: 'input', kind: 'bundle', name: 'whx_bundle_req_chat-1_req_20260909T170000_1234567890abcdef.zip', size: 1, sha256: 'a'.repeat(64), created_at: '2026-09-09T17:00:00Z', expires_at: '2026-10-09T17:00:00Z', bundle: true }] }}
      mode="agent"
      executionMode="protected"
      automationMode="auto"
      busy={false}
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    await waitFor(() => expect(screen.getByRole('status', { name: /80\/80 enviados.*79 recebidos.*novos pedidos continuam permitidos/i })).toBeTruthy())
    expect(screen.getByText('3H ↑80/80 ↓79')).toBeTruthy()
  })

  it('exposes Orchestrator as a first-class workspace mode', () => {
    const onMode = vi.fn()
    render(<WorkspaceTopbar
      session={session()}
      mode="orchestrator"
      executionMode="protected"
      automationMode="auto"
      busy={false}
      onMode={onMode}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    const orchestrator = screen.getByRole('button', { name: 'Orchestrator' })
    expect(orchestrator.className).toContain('active')
    orchestrator.click()
    expect(onMode).toHaveBeenCalledWith('orchestrator')
  })

})
