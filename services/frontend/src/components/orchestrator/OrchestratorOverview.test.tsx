import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { api } from '../../lib/api'
import type { OrchestratorOverview as OverviewData, Session } from '../../types'
import { ChatPanel } from '../ChatPanel'
import { OrchestratorOverview } from './OrchestratorOverview'

const session = {
  id: 'ses-orchestrator', project_path: '/workspace/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'auto', chat_transport_mode: 'scraper', effort_level: 'high', created_at: '2026-09-12T15:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
} satisfies Session

function chatProps(): ComponentProps<typeof ChatPanel> {
  return {
    session,
    items: [],
    chats: [],
    archivedChats: [],
    activeChatId: 'chat-agent',
    busy: false,
    executionMode: 'protected',
    automationMode: 'auto',
    effortLevel: 'high',
    chatTransportMode: 'scraper',
    attachmentsEnabled: true,
    artifactSelection: { context: false, prompt: true, result: false, error: false },
    requestMode: 'direct',
    onExecutionMode: vi.fn(),
    onAutomationMode: vi.fn(),
    onEffortLevel: vi.fn(),
    onChatTransportMode: vi.fn(),
    onKnowledgeSharing: vi.fn(),
    onToggleArtifact: vi.fn(),
    onRequestMode: vi.fn(),
    onSend: vi.fn(async () => undefined),
    onNewChat: vi.fn(async () => undefined),
    onSelectChat: vi.fn(async () => undefined),
    onArchiveChat: vi.fn(async () => undefined),
    onRestoreChat: vi.fn(async () => undefined),
    onDeleteArchivedChat: vi.fn(async () => undefined),
  }
}

async function runAction<T>(action: () => Promise<T>) {
  return action()
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('OrchestratorOverview planning queue', () => {
  it('keeps every submitted objective visible while another draft exists', () => {
    const overview = {
      plans: [{ id: 'opl-1', project_path: session.project_path, title: 'Existing draft', objective: 'First result', status: 'DRAFT', created_at: '2026-09-12T14:58:00.000Z', updated_at: '2026-09-12T14:59:00.000Z' }],
      tasks: [],
      planning_requests: [
        { request_id: 'orp-first', task_id: 'cat-first', objective: 'Split the API safely', status: 'RUNNING', attempt: 1, max_attempts: 3, created_at: '2026-09-12T15:00:00.000Z', updated_at: '2026-09-12T15:01:00.000Z' },
        { request_id: 'orp-second', task_id: 'cat-second', objective: 'Polish the dashboard', status: 'PENDING', attempt: 0, max_attempts: 3, created_at: '2026-09-12T15:02:00.000Z', updated_at: '2026-09-12T15:02:00.000Z' },
        { request_id: 'orp-third', task_id: 'cat-third', objective: 'Recover interrupted planning', status: 'ATTENTION', attempt: 3, max_attempts: 8, last_error: 'Composer unavailable', created_at: '2026-09-12T15:03:00.000Z', updated_at: '2026-09-12T15:03:00.000Z' },
      ],
      mutation_slots: 1,
      mutation_slots_used: 0,
    } satisfies OverviewData

    render(<OrchestratorOverview
      session={session}
      overview={overview}
      chatProps={chatProps()}
      busy={false}
      onProposal={vi.fn()}
      onRun={runAction}
      onOpenTasks={vi.fn()}
      onSelectTask={vi.fn()}
    />)

    expect(screen.getByRole('heading', { name: 'Em planejamento' })).toBeTruthy()
    expect(screen.getByText('Split the API safely')).toBeTruthy()
    expect(screen.getByText('Polish the dashboard')).toBeTruthy()
    expect(screen.getByText('orp-first')).toBeTruthy()
    expect(screen.getByText('orp-second')).toBeTruthy()
    expect(screen.getByText('Recover interrupted planning')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retentar' })).toBeTruthy()
  })

  it('reuses the Agent composer controls and submits its primary action as planning', async () => {
    const overview = { plans: [], tasks: [], planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 } satisfies OverviewData
    const proposal = { request_id: 'orp_20260912T184134_0123456789abcdef', worker_task_id: 'cat-worker', delivery_status: 'PENDING' }
    const propose = vi.spyOn(api, 'proposeOrchestratorPlan').mockResolvedValue(proposal)
    const onProposal = vi.fn()

    render(<OrchestratorOverview
      session={session}
      overview={overview}
      chatProps={chatProps()}
      busy={false}
      onProposal={onProposal}
      onRun={runAction}
      onOpenTasks={vi.fn()}
      onSelectTask={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: 'Protected' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Auto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scraper' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Nível de esforço' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Anexar ficheiros' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Planificar antes de alterar' })).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(/migrar o módulo de autenticação/i), { target: { value: 'Reutilizar exatamente o composer do Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar plano' }))

    await waitFor(() => expect(propose).toHaveBeenCalledWith(session.id, 'Reutilizar exatamente o composer do Agent', {
      include_context: false,
      project_files: [],
      attachment_cache_key: undefined,
      attachments: undefined,
    }))
    expect(onProposal).toHaveBeenCalledWith(proposal)
  })
})
