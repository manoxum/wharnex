import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectTodo, Session } from '../types'

const mocks = vi.hoisted(() => ({
  projectTodos: vi.fn(),
  createProjectTodo: vi.fn(),
  updateProjectTodo: vi.fn(),
  classifyProjectTodo: vi.fn(),
  proposeOrchestratorPlan: vi.fn(),
}))

vi.mock('../lib/api', () => ({ api: mocks }))
vi.mock('../lib/desktop', () => ({ desktopBridge: () => null }))
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
    mocks.proposeOrchestratorPlan.mockReset()
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

  it('presents a terminal classification failure as failed with its diagnostic', async () => {
    mocks.projectTodos.mockResolvedValue({ todos: [{
      ...classified,
      classification_status: 'failed',
      classification_error: 'ChatGPT did not start the file upload before timeout',
      kind: undefined,
      urgency: undefined,
    }] })

    render(<ProjectTodoPanel session={session} chatProps={{} as never} onClose={() => undefined} onError={() => undefined}/>)

    expect(await screen.findByText('Falha na análise')).toBeTruthy()
    expect(screen.queryByText('Análise pendente')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('did not start the file upload')
    expect(screen.getByRole('button', { name: /Tentar novamente/ })).toBeTruthy()
  })
})
