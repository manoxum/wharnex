import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../types'
import { WorkspaceTopbar } from './WorkspaceTopbar'

const mocks = vi.hoisted(() => ({
  gitOverview: vi.fn(async () => ({
    project_path: '/workspace/wharness',
    repository: '', repositories: [],
    project_version: 'v1.2.46.13',
    available: true,
    commit_mode: 'auto',
    current_branch: 'main',
    detached: false,
    has_identity: true,
    branches: [{ name: 'main', current: true, commit_sha: 'abc', ahead: 0, behind: 0, has_upstream: false, gone: false }],
    remotes: [],
    commits: [],
    pending: [],
    working: { clean: true, stageable_count: 0, files: [] },
  })),
}))
vi.mock('../../../lib/transport/http/api', () => ({ api: { gitOverview: mocks.gitOverview } }))

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


  it('keeps project notifications in the top chrome', () => {
    const onAttention = vi.fn()
    render(<WorkspaceTopbar
      session={session()}
      mode="agent"
      executionMode="protected"
      automationMode="auto"
      attention={{ total: 3, urgent: 1, actionable: 2 }}
      busy={false}
      onMode={vi.fn()}
      onAttention={onAttention}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    const button = screen.getByRole('button', { name: /Centro de notificações, 3 alerta\(s\), 1 urgente\(s\), 2 com ação/ })
    expect(button.className).toContain('has-alerts')
    expect(button.className).toContain('urgent')
    expect(button.getAttribute('data-attention-trigger')).toBe('true')
    expect(button.getAttribute('title')).toBe('Notificações · ver alertas recentes')
    expect(button.textContent).toContain('3')
    button.click()
    expect(onAttention).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/3H ↑/)).toBeNull()
  })


  it('shows the current branch and project version instead of instance identity', async () => {
    render(<WorkspaceTopbar
      config={{ planner: 'manual', sandbox: 'docker', model: 'test', version: 'v1.2.46.13', api_configured: false, chatgpt_web_embed: false }}
      session={session()}
      mode="agent"
      executionMode="protected"
      automationMode="auto"
      busy={false}
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
    />)
    expect(await screen.findByRole('button', { name: 'Git: main, projeto v1.2.46.13' })).toBeTruthy()
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

  it('renders workspace modes as icon-only controls with accessible names', () => {
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
    for (const name of ['Editor', 'Agent', 'Orchestrator']) {
      const button = screen.getByRole('button', { name })
      expect(button.textContent).toBe('')
      expect(button.getAttribute('title')).toBe(name)
    }
  })

})
