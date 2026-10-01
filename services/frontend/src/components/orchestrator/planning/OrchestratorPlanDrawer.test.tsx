import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatAgentTask, OrchestratorPlanningDetail, OrchestratorPlanningRequest, OrchestratorTask } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { OrchestratorPlanDrawer } from './OrchestratorPlanDrawer'

const request: OrchestratorPlanningRequest = {
  request_id: 'orp-detail',
  task_id: 'cat-detail',
  objective: 'Detalhar request',
  status: 'RUNNING',
  phase: 'PLANNING',
  attempt: 2,
  max_attempts: 8,
  created_at: '2026-09-28T01:00:00Z',
  updated_at: '2026-09-28T01:05:00Z',
}

afterEach(() => {
  delete window.wharnessDesktop
  vi.restoreAllMocks()
})

function installDesktopBridge() {
  const agents = {
    openMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, alreadyOpen: false })),
    onState: vi.fn<(listener: (state: DesktopAgentRuntimeState) => void) => () => void>(() => () => undefined),
    closeMonitor: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
    openInteraction: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    setInteractionBounds: vi.fn(async (agentId: string, bounds: DesktopBounds) => ({ ok: true, agentId, bounds })),
    closeInteraction: vi.fn(async (agentId: string) => ({ ok: true, agentId, closed: true })),
  }
  window.wharnessDesktop = { agents } as unknown as WharnessDesktopBridge
  return agents
}

const emptyDetail: OrchestratorPlanningDetail = {
  request_id: request.request_id,
  task_id: request.task_id,
  status: request.status,
  attempt: request.attempt,
  max_attempts: request.max_attempts,
  objective: request.objective,
  include_context: false,
  project_files: [],
  attachments: [],
  attempts: [],
  tasks: [],
}

it('keeps all detail tabs available across loading, error and empty states', () => {
  const props = { request, onClose: vi.fn(), onRefresh: vi.fn() }
  const view = render(<OrchestratorPlanDrawer {...props} loading detail={undefined}/>)

  for (const label of ['Resumo', 'Ficheiros', 'Plano', 'Tasks', 'Execuções', 'Engine']) {
    expect(screen.getByRole('tab', { name: label })).toBeTruthy()
  }
  expect(screen.getByRole('status').textContent).toContain('A carregar detalhe')

  view.rerender(<OrchestratorPlanDrawer {...props} loading={false} detail={undefined} error="Falha de leitura"/>)
  expect(screen.getByRole('alert').textContent).toContain('Falha de leitura')
  expect(screen.getByRole('tab', { name: 'Engine' })).toBeTruthy()

  view.rerender(<OrchestratorPlanDrawer {...props} loading={false} detail={emptyDetail}/>)
  expect(screen.getByRole('tab', { name: 'Engine' })).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Ficheiros' }))
  expect(screen.getByText('Nenhum bundle de pedido ou resposta foi registado para este planeamento.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Plano' }))
  expect(screen.getByText(/Planeamento ainda não concluído\/importado/)).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
  expect(screen.getByText('Nenhuma task foi criada para este plano.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Execuções' }))
  expect(screen.getByText('Ainda não existem execuções registradas para este pedido.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Engine' }))
  expect(screen.getByText('Nenhum Worker associado ao planeamento')).toBeTruthy()
  const engine = screen.getByTestId('orchestrator-plan-engine')
  expect(engine.className).toContain('overflow-hidden')
  expect(engine.className).toContain('h-[clamp(320px,62vh,680px)]')
})

it('embeds the planning Worker in Engine without opening the native monitor', async () => {
  const agents = installDesktopBridge()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300, toJSON: () => ({}) } as DOMRect)
  const planningTask = {
    task_id: request.task_id,
    type: 'ORCHESTRATOR_PLAN',
    status: 'RUNNING',
    lease_owner: 'planner:worker-7',
    chat_id: request.request_id,
    session_id: 'ses-owner',
  } as unknown as ChatAgentTask

  render(<OrchestratorPlanDrawer request={request} detail={emptyDetail} planningTask={planningTask} loading={false} onClose={vi.fn()} onRefresh={vi.fn()}/>)

  expect(screen.queryByRole('button', { name: /Acompanhar Worker/ })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Engine' }))

  await waitFor(() => expect(agents.openInteraction).toHaveBeenCalledWith('worker-7', { x: 10, y: 20, width: 400, height: 300 }))
  expect(screen.getByLabelText('Worker incorporado Worker 7')).toBeTruthy()
  expect(agents.openMonitor).not.toHaveBeenCalled()
})

it('shows plan identity and delegates close and refresh actions', () => {
  const onClose = vi.fn()
  const onRefresh = vi.fn()
  const onOpenTasks = vi.fn()
  const detail: OrchestratorPlanningDetail = {
    ...emptyDetail,
    plan: {
      id: 'opl-detail',
      project_path: '/workspace/demo',
      title: 'Plano detalhado',
      objective: 'Executar o plano',
      status: 'ACTIVE',
      created_at: '2026-09-28T01:01:00Z',
      updated_at: '2026-09-28T01:06:00Z',
    },
  }
  render(<OrchestratorPlanDrawer request={request} detail={detail} loading={false} onClose={onClose} onRefresh={onRefresh} onOpenTasks={onOpenTasks}/>)

  expect(screen.getByText(request.request_id)).toBeTruthy()
  expect(screen.getAllByText('Em andamento').length).toBeGreaterThan(0)
  expect(screen.getByText(request.status)).toBeTruthy()
  expect(screen.getByText('Tentativa 2/8')).toBeTruthy()
  expect(screen.getByText(/Criado .* Atualizado/)).toBeTruthy()
  expect(screen.getByText('opl-detail')).toBeTruthy()
  expect(screen.getByText('Plano detalhado')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Ver tasks' }))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar detalhe do planeamento' }))
  fireEvent.click(screen.getByRole('button', { name: 'Fechar detalhe do planeamento' }))
  expect(onOpenTasks).toHaveBeenCalledWith('opl-detail')
  expect(onRefresh).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})


it('shows a draft awaiting decision as Em análise and keeps all decision actions available', () => {
  const onApprove = vi.fn()
  const onReject = vi.fn()
  const onRevise = vi.fn()
  const draftRequest: OrchestratorPlanningRequest = {
    ...request,
    status: 'DONE',
    phase: 'AWAITING_APPROVAL',
  }
  const detail: OrchestratorPlanningDetail = {
    ...emptyDetail,
    status: 'DONE',
    plan: { ...planFixture(), status: 'DRAFT' },
  }

  render(<OrchestratorPlanDrawer
    request={draftRequest}
    detail={detail}
    loading={false}
    onClose={vi.fn()}
    onRefresh={vi.fn()}
    onApprove={onApprove}
    onReject={onReject}
    onRevise={onRevise}
  />)

  expect(screen.getAllByText('Em análise').length).toBeGreaterThan(0)
  expect(screen.queryByText('Concluído')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Aprovar plano' }))
  fireEvent.click(screen.getByRole('button', { name: 'Recusar plano' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir alteração' }))

  expect(onApprove).toHaveBeenCalledWith('opl-detail')
  expect(onReject).toHaveBeenCalledWith('opl-detail')
  expect(onRevise).toHaveBeenCalledWith('opl-detail')
})

it('keeps Review distinct from completion and preserves plan tasks and executions access', () => {
  const onOpenTasks = vi.fn()
  const reviewTask = { ...taskFixture('task-review', 'Rever resultado'), status: 'REVIEW' as const }
  const detail: OrchestratorPlanningDetail = {
    ...emptyDetail,
    plan: { ...planFixture(), status: 'ACTIVE' },
    tasks: [{ task: reviewTask, runs: [] }],
  }
  const reviewRequest: OrchestratorPlanningRequest = {
    ...request,
    status: 'DONE',
    phase: 'REVIEW',
  }

  const view = render(<OrchestratorPlanDrawer
    request={reviewRequest}
    detail={detail}
    loading={false}
    onClose={vi.fn()}
    onRefresh={vi.fn()}
    onOpenTasks={onOpenTasks}
  />)

  expect(screen.getAllByText('Review').length).toBeGreaterThan(0)
  expect(screen.getByText(/Review ainda não é conclusão/)).toBeTruthy()
  expect(screen.getByText(/COMPLETE ou preservam evidência equivalente/)).toBeTruthy()
  expect(screen.queryByText('Concluído')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Ver tasks' }))
  expect(onOpenTasks).toHaveBeenCalledWith('opl-detail')

  fireEvent.click(screen.getByRole('tab', { name: 'Execuções' }))
  expect(screen.getByText('Rever resultado')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Abrir task Rever resultado' })).toBeTruthy()

  const completedRequest: OrchestratorPlanningRequest = {
    ...reviewRequest,
    phase: 'COMPLETED',
  }
  view.rerender(<OrchestratorPlanDrawer
    request={completedRequest}
    detail={{ ...detail, plan: { ...planFixture(), status: 'COMPLETED' } }}
    loading={false}
    onClose={vi.fn()}
    onRefresh={vi.fn()}
    onOpenTasks={onOpenTasks}
  />)

  expect(screen.getAllByText('Concluído').length).toBeGreaterThan(0)
  expect(screen.getByRole('tab', { name: 'Tasks' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'Execuções' })).toBeTruthy()
})


it('shows only planning bundles even when the detail contains other file context', () => {
  const bundle = (id: string, direction: 'input' | 'output', name: string) => ({
    id, request_id: request.request_id, direction, kind: 'bundle', name, size: 2048, sha256: id, created_at: '2026-09-28T01:02:00Z', expires_at: '2026-10-28T01:02:00Z', bundle: true,
  })
  const detail: OrchestratorPlanningDetail = {
    ...emptyDetail,
    project_files: ['src/input.ts'],
    attachments: [{ name: 'notes.md', size: 12, mime: 'text/markdown' }],
    bundles: [
      bundle('art-req', 'input', 'whx_bundle_req_orchestrator_orp-detail.zip'),
      bundle('art-res', 'output', 'whx_bundle_res_orchestrator_orp-detail.zip'),
    ],
    plan: planFixture(),
    tasks: [
      { task: taskFixture('task-a', 'Preparar base', [], { impact_files: ['src/shared.ts'], read_files: ['src/read.ts'] }), runs: [] },
      { task: taskFixture('task-b', 'Consumir base', ['task-a'], { barrier_files: ['src/barrier.ts'] }), runs: [] },
    ],
  }
  const artifactEntries = vi.spyOn(api, 'artifactEntries').mockResolvedValue({ entries: [] })
  render(<OrchestratorPlanDrawer request={request} detail={detail} sessionId="ses_owner" loading={false} onClose={vi.fn()} onRefresh={vi.fn()}/>)
  fireEvent.click(screen.getByRole('tab', { name: 'Ficheiros' }))

  expect(screen.getByText('Bundles trocados com o GPT')).toBeTruthy()
  expect(screen.getByText('whx_bundle_req_orchestrator_orp-detail.zip')).toBeTruthy()
  expect(screen.getByText('whx_bundle_res_orchestrator_orp-detail.zip')).toBeTruthy()
  expect(screen.getByText('Pedido enviado')).toBeTruthy()
  expect(screen.getByText('Resposta do GPT')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Pesquisar ficheiros e escopo' })).toBeNull()
  for (const hidden of ['Entrada do utilizador', 'Escopo previsto pelo Planner', 'src/input.ts', 'notes.md', 'src/shared.ts', 'src/read.ts', 'src/barrier.ts']) {
    expect(screen.queryByText(hidden)).toBeNull()
  }

  fireEvent.click(screen.getAllByRole('button', { name: /Explorar/ })[0])
  expect(screen.getByRole('dialog', { name: 'Explorar whx_bundle_req_orchestrator_orp-detail.zip' })).toBeTruthy()
  expect(artifactEntries).toHaveBeenCalledWith('ses_owner', 'art-req')
  artifactEntries.mockRestore()
})

it('shows plan metadata, assumptions and searchable task dependencies', () => {
  const detail: OrchestratorPlanningDetail = {
    ...emptyDetail,
    plan: { ...planFixture(), assumptions: ['API de detalhe já disponível'] },
    tasks: [
      { task: taskFixture('task-a', 'Preparar base'), runs: [] },
      { task: taskFixture('task-b', 'Consumir base', ['task-a']), runs: [] },
    ],
  }
  render(<OrchestratorPlanDrawer request={request} detail={detail} loading={false} onClose={vi.fn()} onRefresh={vi.fn()}/>)
  fireEvent.click(screen.getByRole('tab', { name: 'Plano' }))

  expect(screen.getAllByText('Plano detalhado').length).toBeGreaterThan(0)
  expect(screen.getByText('Executar o plano')).toBeTruthy()
  expect(screen.getByText('ACTIVE')).toBeTruthy()
  expect(screen.getByText('API de detalhe já disponível')).toBeTruthy()
  expect(screen.getByText('Ponto de entrada · sem dependências')).toBeTruthy()
  expect(screen.getByText('← Preparar base')).toBeTruthy()

  fireEvent.change(screen.getByRole('textbox', { name: 'Pesquisar tasks e dependências' }), { target: { value: 'Consumir' } })
  expect(screen.getByText('Consumir base')).toBeTruthy()
  expect(screen.queryByText('Preparar base')).toBeNull()
})

function planFixture() {
  return {
    id: 'opl-detail',
    project_path: '/workspace/demo',
    title: 'Plano detalhado',
    objective: 'Executar o plano',
    status: 'ACTIVE' as const,
    created_at: '2026-09-28T01:01:00Z',
    updated_at: '2026-09-28T01:06:00Z',
  }
}

function taskFixture(
  id: string,
  title: string,
  dependsOn: string[] = [],
  files: Partial<Pick<OrchestratorTask, 'impact_files' | 'read_files' | 'barrier_files'>> = {},
): OrchestratorTask {
  return {
    id,
    project_path: '/workspace/demo',
    plan_id: 'opl-detail',
    title,
    status: 'READY',
    condition: dependsOn.length ? 'dependency' : 'none',
    priority: 'normal',
    depends_on: dependsOn,
    parallelizable: true,
    created_at: '2026-09-28T01:01:00Z',
    updated_at: '2026-09-28T01:06:00Z',
    ...files,
  }
}
