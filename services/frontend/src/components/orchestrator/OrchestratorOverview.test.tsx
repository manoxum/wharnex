import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import QuillDelta from 'quill-delta'
import { api } from '../../lib/api'
import type { OrchestratorOverview as OverviewData, Session } from '../../types'
import { ChatPanel } from '../ChatPanel'
import { directivesToDelta, findComposerEditor } from '../../lib/composerRichText'
import { OrchestratorOverview } from './OrchestratorOverview'

// jsdom cannot simulate real keystrokes into Quill's contenteditable, so this
// drives the composer directly through its Quill instance — the same escape
// hatch ChatPanel.test.tsx uses, reached here via findComposerEditor because
// this composer is embedded several components deep, with no ref threaded
// down to it.
function typeInComposer(container: HTMLElement, text: string) {
  const editor = findComposerEditor(container)
  if (!editor) throw new Error('composer editor not mounted')
  act(() => { editor.setContents(new QuillDelta(directivesToDelta(text).ops) as never, 'user') })
}

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
  it('keeps a failed execution visible and selectable beyond the five recent tasks', () => {
    const failed = {
      id: 'otk-failed', project_path: session.project_path, title: 'Recompor cards', status: 'FAILED' as const,
      condition: 'failed_run' as const, priority: 'normal' as const, parallelizable: false,
      created_at: '2026-09-12T14:00:00.000Z', updated_at: '2026-09-12T14:01:00.000Z',
    }
    const newer = Array.from({ length: 6 }, (_, index) => ({
      ...failed, id: `otk-${index}`, title: `Tarefa ${index}`, condition: 'none' as const,
      updated_at: `2026-09-12T15:0${index}:00.000Z`,
    }))
    const onSelectTask = vi.fn()
    render(<OrchestratorOverview
      session={session}
      overview={{ plans: [], tasks: [failed, ...newer], planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 }}
      chatProps={chatProps()}
      busy={false}
      onProposal={vi.fn()}
      onRun={runAction}
      onOpenTasks={vi.fn()}
      onSelectTask={onSelectTask}
    />)

    const attention = screen.getByRole('region', { name: 'Tarefas que requerem atenção' })
    expect(attention.textContent).toContain('1 tarefa falhou')
    fireEvent.click(screen.getByRole('button', { name: /Recompor cards/ }))
    expect(onSelectTask).toHaveBeenCalledWith(failed)
  })

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

    const view = render(<OrchestratorOverview
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

    typeInComposer(view.container, 'Reutilizar exatamente o composer do Agent')
    fireEvent.click(screen.getByRole('button', { name: 'Gerar plano' }))

    await waitFor(() => expect(propose).toHaveBeenCalledWith(session.id, 'Reutilizar exatamente o composer do Agent', {
      include_context: false,
      project_files: [],
      attachment_cache_key: undefined,
      attachments: undefined,
    }))
    expect(onProposal).toHaveBeenCalledWith(proposal)
  })

  it('offers reject and revise decisions for a proposed plan', async () => {
    const overview = {
      plans: [{ id: 'opl-draft', project_path: session.project_path, title: 'Draft plan', objective: 'Ship safely', status: 'DRAFT', planner_request_id: 'orp-old', created_at: '2026-09-12T15:00:00.000Z', updated_at: '2026-09-12T15:00:00.000Z' }],
      tasks: [{ id: 'otk-1', project_path: session.project_path, plan_id: 'opl-draft', title: 'Backend', status: 'PENDING', condition: 'plan_approval', priority: 'normal', parallelizable: false, created_at: '2026-09-12T15:00:00.000Z', updated_at: '2026-09-12T15:00:00.000Z' }],
      planning_requests: [], mutation_slots: 1, mutation_slots_used: 0,
    } satisfies OverviewData
    const reject = vi.spyOn(api, 'rejectOrchestratorPlan').mockResolvedValue({ ...overview, plans: [{ ...overview.plans[0], status: 'ARCHIVED' }], tasks: [{ ...overview.tasks[0], status: 'ARCHIVED', condition: 'none' }] })
    const revised = { request_id: 'orp-revised', worker_task_id: 'cat-revised', delivery_status: 'PENDING' }
    const revise = vi.spyOn(api, 'reviseOrchestratorPlan').mockResolvedValue(revised)
    const onProposal = vi.fn()

    const view = render(<OrchestratorOverview
      session={session}
      overview={overview}
      chatProps={chatProps()}
      busy={false}
      onProposal={onProposal}
      onRun={runAction}
      onOpenTasks={vi.fn()}
      onSelectTask={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    await waitFor(() => expect(reject).toHaveBeenCalledWith(session.id, 'opl-draft'))
    expect(onProposal).toHaveBeenCalledWith(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Pedir alteração' }))
    const input = await screen.findByLabelText('Alteração pretendida')
    fireEvent.change(input, { target: { value: 'Adicionar rollback antes do cutover' } })
    const revisionButtons = screen.getAllByRole('button', { name: 'Pedir alteração' })
    fireEvent.click(revisionButtons[revisionButtons.length - 1])
    await waitFor(() => expect(revise).toHaveBeenCalledWith(session.id, 'opl-draft', 'Adicionar rollback antes do cutover'))
    expect(onProposal).toHaveBeenCalledWith(revised)

    view.unmount()
  })

})
