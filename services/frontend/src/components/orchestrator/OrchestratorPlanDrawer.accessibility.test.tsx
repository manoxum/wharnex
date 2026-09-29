import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { OrchestratorPlanningDetail, OrchestratorPlanningRequest, OrchestratorTask } from '../../types'
import { OrchestratorPlanDrawer } from './OrchestratorPlanDrawer'

const request: OrchestratorPlanningRequest = {
  request_id: 'orp-accessible',
  task_id: 'cat-accessible',
  objective: 'Validar detalhe acessível',
  status: 'ATTENTION',
  attempt: 2,
  max_attempts: 6,
  created_at: '2026-09-28T01:00:00Z',
  updated_at: '2026-09-28T01:10:00Z',
}

it('focuses the dialog controls, closes with Escape and restores focus', () => {
  const opener = document.createElement('button')
  opener.textContent = 'Abrir detalhe'
  document.body.append(opener)
  opener.focus()
  const onClose = vi.fn()
  const view = render(<OrchestratorPlanDrawer request={request} loading={false} onClose={onClose} onRefresh={vi.fn()}/>)

  const dialog = screen.getByRole('dialog')
  const close = screen.getByRole('button', { name: 'Fechar detalhe do planeamento' })
  const scroll = screen.getByTestId('orchestrator-plan-detail-scroll')
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.getAttribute('aria-labelledby')).toBe('orchestrator-plan-detail-title')
  expect(dialog.className).toContain('w-full')
  expect(dialog.className).toContain('max-w-[620px]')
  expect(scroll.className).toContain('overflow-y-auto')
  expect(document.activeElement).toBe(close)
  const refresh = screen.getByRole('button', { name: 'Atualizar detalhe do planeamento' })
  refresh.focus()
  fireEvent.keyDown(refresh, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Execuções' }))

  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(document.activeElement).toBe(opener)
  opener.remove()
})

it('summarizes multiple attempts and runs while exposing only relevant actions', () => {
  const onRetry = vi.fn()
  const onApprove = vi.fn()
  const onReject = vi.fn()
  const onRevise = vi.fn()
  const onOpenTasks = vi.fn()
  const detail = detailFixture()
  const view = render(<OrchestratorPlanDrawer
    request={request}
    detail={detail}
    loading={false}
    onClose={vi.fn()}
    onRefresh={vi.fn()}
    onRetry={onRetry}
    onApprove={onApprove}
    onReject={onReject}
    onRevise={onRevise}
    onOpenTasks={onOpenTasks}
  />)

  expect(screen.getByText(/1 task · 2 execuções · 2 tentativas de planeamento/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Retentar planeamento/ }))
  fireEvent.click(screen.getByRole('button', { name: /Aprovar plano/ }))
  fireEvent.click(screen.getByRole('button', { name: /Rejeitar plano/ }))
  fireEvent.click(screen.getByRole('button', { name: /Revisar plano/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ver tasks' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
  expect(onApprove).toHaveBeenCalledWith('opl-accessible')
  expect(onReject).toHaveBeenCalledWith('opl-accessible')
  expect(onRevise).toHaveBeenCalledWith('opl-accessible')
  expect(onOpenTasks).toHaveBeenCalledWith('opl-accessible')

  view.rerender(<OrchestratorPlanDrawer
    request={{ ...request, status: 'RUNNING' }}
    detail={{ ...detail, status: 'RUNNING', plan: { ...detail.plan!, status: 'ACTIVE' } }}
    loading={false}
    onClose={vi.fn()}
    onRefresh={vi.fn()}
    onRetry={onRetry}
    onApprove={onApprove}
  />)
  expect(screen.queryByRole('button', { name: /Retentar planeamento/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Aprovar plano/ })).toBeNull()
})

function detailFixture(): OrchestratorPlanningDetail {
  const task: OrchestratorTask = {
    id: 'task-accessible', project_path: '/workspace/demo', plan_id: 'opl-accessible', title: 'Executar validações',
    status: 'REVIEW', condition: 'none', priority: 'normal', parallelizable: true,
    created_at: '2026-09-28T01:01:00Z', updated_at: '2026-09-28T01:08:00Z',
  }
  return {
    request_id: request.request_id, task_id: request.task_id, status: request.status, attempt: 2, max_attempts: 6,
    objective: request.objective, include_context: false, project_files: [], attachments: [],
    attempts: [
      { task_id: 'cat-old', status: 'FAILED', attempt: 1, max_attempts: 6, created_at: request.created_at, updated_at: request.created_at },
      { task_id: request.task_id, status: 'ATTENTION', attempt: 2, max_attempts: 6, created_at: request.created_at, updated_at: request.updated_at },
    ],
    plan: { id: 'opl-accessible', project_path: '/workspace/demo', title: 'Plano acessível', objective: request.objective || '', status: 'DRAFT', created_at: request.created_at, updated_at: request.updated_at },
    tasks: [{ task, runs: [
      { id: 'run-one', task_id: task.id, project_path: task.project_path, attempt: 1, status: 'FAILED', started_at: request.created_at, completed_at: request.updated_at },
      { id: 'run-two', task_id: task.id, project_path: task.project_path, attempt: 2, status: 'RUNNING', started_at: request.updated_at },
    ] }],
  }
}
