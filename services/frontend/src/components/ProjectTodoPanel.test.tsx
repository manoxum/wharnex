import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectTodo, Session } from '../types'

const mocks = vi.hoisted(() => ({
  projectTodos: vi.fn(),
  createProjectTodo: vi.fn(),
  updateProjectTodo: vi.fn(),
  classifyProjectTodo: vi.fn(),
  archiveProjectTodo: vi.fn(),
  deleteProjectTodo: vi.fn(),
  proposeOrchestratorPlan: vi.fn(),
  desktopBridge: undefined as unknown,
  confirmDialog: vi.fn(),
}))

vi.mock('../lib/api', () => ({ api: mocks }))
vi.mock('../lib/desktop', () => ({ desktopBridge: () => mocks.desktopBridge }))
vi.mock('../lib/appDialog', () => ({ confirmDialog: mocks.confirmDialog }))
vi.mock('./ChatPanel', () => ({
  ChatPanel: (props: { composerPlaceholder?: string; onSend?: (message: string, attachments: File[], projectFiles: string[]) => Promise<void> }) => <div data-testid="todo-composer">
    <span>{props.composerPlaceholder}</span>
    <button type="button" onClick={() => void props.onSend?.('Nova ideia', [], [])}>Enviar TODO mock</button>
  </div>,
}))

import { ProjectTodoPanel } from './ProjectTodoPanel'

const session = { id: 'session-1' } as Session
const classified: ProjectTodo = {
  id: 'todo-1', project_path: '/tmp/demo', body: 'Melhorar a pesquisa', status: 'open', kind: 'improvement', urgency: 'normal',
  classification_status: 'classified', description: 'Tornar a pesquisa mais rápida e previsível sem alterar o fluxo principal.',
  pre_plan: ['Medir o fluxo atual.', 'Ajustar a implementação.', 'Cobrir o comportamento com testes.'],
  created_at: '2026-09-17T10:00:00Z', updated_at: '2026-09-17T10:01:00Z',
}

describe('ProjectTodoPanel', () => {
  beforeEach(() => {
    mocks.projectTodos.mockReset().mockResolvedValue({ todos: [classified] })
    mocks.createProjectTodo.mockReset().mockResolvedValue({ ...classified, id: 'todo-2', body: 'Nova ideia', classification_status: 'queued', description: undefined, pre_plan: undefined })
    mocks.updateProjectTodo.mockReset()
    mocks.classifyProjectTodo.mockReset()
    mocks.archiveProjectTodo.mockReset()
    mocks.deleteProjectTodo.mockReset().mockResolvedValue(undefined)
    mocks.proposeOrchestratorPlan.mockReset()
    mocks.confirmDialog.mockReset().mockResolvedValue(true)
    mocks.desktopBridge = undefined
  })

  it('keeps every TODO state on one semantic icon tab and names processing as Fazendo', async () => {
    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)
    await screen.findByText('Melhorar a pesquisa')

    const tabs = screen.getByRole('navigation', { name: 'Estado dos TODOs' })
    const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons).toHaveLength(5)
    expect(buttons.map((button) => button.title)).toEqual(['Abertos', 'Fazendo', 'Feito', 'Falha', 'Concluídos'])
    expect(buttons.every((button) => Boolean(button.querySelector('svg')))).toBe(true)
    expect(tabs.textContent).toContain('Fazendo')
    expect(tabs.textContent).not.toContain('Pendente/Execução')
  })

  it('keeps the composer hidden behind the add FAB and shows worker enrichment', async () => {
    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)

    expect(screen.queryByTestId('todo-composer')).toBeNull()
    expect(await screen.findByText('Tornar a pesquisa mais rápida e previsível sem alterar o fluxo principal.')).toBeTruthy()
    expect(screen.getByText('Pré-plano')).toBeTruthy()
    expect(screen.getByText('Medir o fluxo atual.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar nova ideia' }))
    expect(screen.getByTestId('todo-composer')).toBeTruthy()
    expect(screen.getByText('Descreva a ideia, necessidade, erro ou melhoria…')).toBeTruthy()
  })

  it('closes the bottom composer after a TODO is created', async () => {
    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)
    await screen.findByText('Melhorar a pesquisa')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar nova ideia' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar TODO mock' }))

    await waitFor(() => expect(mocks.createProjectTodo).toHaveBeenCalledWith('session-1', expect.objectContaining({ body: 'Nova ideia' })))
    await waitFor(() => expect(screen.queryByTestId('todo-composer')).toBeNull())
  })

  it('orders TODOs by urgency while keeping unclassified items last', async () => {
    const veryUrgent = { ...classified, id: 'todo-very-urgent', body: 'Bloqueio crítico', urgency: 'very_urgent' as const }
    const urgent = { ...classified, id: 'todo-urgent', body: 'Corrigir regressão', urgency: 'urgent' as const }
    const noUrgency = { ...classified, id: 'todo-no-urgency', body: 'Melhoria futura', urgency: 'no_urgency' as const }
    const unclassified = { ...classified, id: 'todo-queued', body: 'Ideia ainda por classificar', urgency: undefined, kind: undefined, classification_status: 'queued' as const }
    mocks.projectTodos.mockResolvedValue({ todos: [unclassified, noUrgency, classified, urgent, veryUrgent] })

    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)
    await screen.findByText('Bloqueio crítico')

    expect(screen.getAllByRole('article').map((card) => card.textContent)).toEqual([
      expect.stringContaining('Bloqueio crítico'),
      expect.stringContaining('Corrigir regressão'),
      expect.stringContaining('Melhorar a pesquisa'),
      expect.stringContaining('Melhoria futura'),
      expect.stringContaining('Ideia ainda por classificar'),
    ])
  })
  it('forwards the complete worker pre-analysis to the Orchestrator as a disposable attachment', async () => {
    const persist = vi.fn().mockResolvedValue({ ok: true, attachments: [{ name: 'wharnex-todo-todo-1-pre-analysis.md', size: 128, mime: 'text/markdown', storageRef: 'orch_todo_test/msg/file', previewKind: 'icon' }] })
    const removeChat = vi.fn().mockResolvedValue({ ok: true })
    mocks.desktopBridge = { attachments: { persist, read: vi.fn(), removeChat } }
    mocks.proposeOrchestratorPlan.mockResolvedValue({ request_id: 'orp_12345678', worker_task_id: 'task-1', delivery_status: 'PENDING' })

    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)
    await screen.findByText('Melhorar a pesquisa')
    fireEvent.click(screen.getByRole('button', { name: 'Orchestrator' }))

    await waitFor(() => expect(persist).toHaveBeenCalled())
    const persistInput = persist.mock.calls[0][0]
    expect(persistInput.attachments).toHaveLength(1)
    expect(persistInput.attachments[0].name).toBe('wharnex-todo-todo-1-pre-analysis.md')
    await waitFor(() => expect(mocks.proposeOrchestratorPlan).toHaveBeenCalledWith('session-1', 'Melhorar a pesquisa', expect.objectContaining({
      attachments: [expect.objectContaining({ name: 'wharnex-todo-todo-1-pre-analysis.md', storage_ref: 'orch_todo_test/msg/file' })],
    })))
    expect(removeChat).not.toHaveBeenCalled()
  })

  it('archives a TODO and moves it into the Arquivados tab', async () => {
    mocks.archiveProjectTodo.mockResolvedValue({ ...classified, archived_at: '2026-09-18T12:00:00Z' })
    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)
    await screen.findByText('Melhorar a pesquisa')

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar TODO' }))
    await waitFor(() => expect(mocks.archiveProjectTodo).toHaveBeenCalledWith('session-1', 'todo-1', true))

    await waitFor(() => expect(screen.queryByText('Melhorar a pesquisa')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Arquivados/ }))
    expect(await screen.findByText('Melhorar a pesquisa')).toBeTruthy()
  })

  it('asks for confirmation before deleting a TODO, and removes it once confirmed', async () => {
    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)
    await screen.findByText('Melhorar a pesquisa')

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar TODO' }))
    await waitFor(() => expect(mocks.confirmDialog).toHaveBeenCalled())
    await waitFor(() => expect(mocks.deleteProjectTodo).toHaveBeenCalledWith('session-1', 'todo-1'))
    await waitFor(() => expect(screen.queryByText('Melhorar a pesquisa')).toBeNull())
  })

  it('does not delete a TODO when the confirmation is declined', async () => {
    mocks.confirmDialog.mockResolvedValue(false)
    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)
    await screen.findByText('Melhorar a pesquisa')

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar TODO' }))
    await waitFor(() => expect(mocks.confirmDialog).toHaveBeenCalled())
    expect(mocks.deleteProjectTodo).not.toHaveBeenCalled()
    expect(screen.getByText('Melhorar a pesquisa')).toBeTruthy()
  })

})
