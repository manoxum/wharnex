import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { OrchestratorPlanningDetail, OrchestratorPlanningRequest, OrchestratorTask } from '../../types'
import { api } from '../../lib/api'
import { OrchestratorPlanDrawer } from './OrchestratorPlanDrawer'

const request: OrchestratorPlanningRequest = {
  request_id: 'orp-detail',
  task_id: 'cat-detail',
  objective: 'Detalhar request',
  status: 'RUNNING',
  attempt: 2,
  max_attempts: 8,
  created_at: '2026-09-28T01:00:00Z',
  updated_at: '2026-09-28T01:05:00Z',
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

  for (const label of ['Resumo', 'Ficheiros', 'Plano', 'Tasks', 'Execuções']) {
    expect(screen.getByRole('tab', { name: label })).toBeTruthy()
  }
  expect(screen.getByRole('status').textContent).toContain('A carregar detalhe')

  view.rerender(<OrchestratorPlanDrawer {...props} loading={false} detail={undefined} error="Falha de leitura"/>)
  expect(screen.getByRole('alert').textContent).toContain('Falha de leitura')

  view.rerender(<OrchestratorPlanDrawer {...props} loading={false} detail={emptyDetail}/>)
  fireEvent.click(screen.getByRole('tab', { name: 'Ficheiros' }))
  expect(screen.getByText('Nenhum bundle de pedido ou resposta foi registado para este planeamento.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Plano' }))
  expect(screen.getByText(/Planeamento ainda não concluído\/importado/)).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
  expect(screen.getByText('Nenhuma task foi criada para este plano.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Execuções' }))
  expect(screen.getByText('Ainda não existem execuções registradas para este pedido.')).toBeTruthy()
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
