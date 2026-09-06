import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { WorkspaceTopbar } from './WorkspaceTopbar'

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

})
