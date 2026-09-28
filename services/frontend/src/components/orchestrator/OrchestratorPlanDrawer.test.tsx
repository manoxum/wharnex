import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { OrchestratorPlanningDetail, OrchestratorPlanningRequest } from '../../types'
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
  expect(screen.getByText('Este pedido não possui ficheiros ou anexos associados.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Plano' }))
  expect(screen.getByText('O plano ainda não foi persistido para este request.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
  expect(screen.getByText('Nenhuma task foi criada para este plano.')).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Execuções' }))
  expect(screen.getByText('Ainda não existem execuções registradas para este pedido.')).toBeTruthy()
})

it('shows plan identity and delegates close and refresh actions', () => {
  const onClose = vi.fn()
  const onRefresh = vi.fn()
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
  render(<OrchestratorPlanDrawer request={request} detail={detail} loading={false} onClose={onClose} onRefresh={onRefresh}/>)

  expect(screen.getByText(request.request_id)).toBeTruthy()
  expect(screen.getByText(request.status)).toBeTruthy()
  expect(screen.getByText('Tentativa 2/8')).toBeTruthy()
  expect(screen.getByText(/Criado .* Atualizado/)).toBeTruthy()
  expect(screen.getByText('opl-detail')).toBeTruthy()
  expect(screen.getByText('Plano detalhado')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Atualizar detalhe do planeamento' }))
  fireEvent.click(screen.getByRole('button', { name: 'Fechar detalhe do planeamento' }))
  expect(onRefresh).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})
