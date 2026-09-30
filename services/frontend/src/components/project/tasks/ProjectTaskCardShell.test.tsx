import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatAgentTask, Session } from '../../../types'
import { readStyleSource } from '../../../styles/cascade/readStyleSource'
import { ProjectTaskListPanel } from './ProjectTaskListPanel'
import { ProjectTaskCardShell } from './ProjectTaskCardShell'

const mocks = vi.hoisted(() => ({
  projectTasks: vi.fn(),
  executionConcurrency: vi.fn(),
  updateExecutionConcurrency: vi.fn(),
  getSession: vi.fn(),
  eventHistory: vi.fn(),
  orchestratorTaskRuns: vi.fn(),
  chatAgentTaskEvents: vi.fn(),
}))

vi.mock('../../../lib/transport/http/api', () => ({ api: mocks }))

import { ProjectTasksDrawer } from './ProjectTasksDrawer'

const currentSession = { id: 'session-current', project_path: '/project/a', request_lineages: {} } as Session
const legacyCss = readStyleSource('styles/legacy/styles.css')

function task(taskID: string, status: string, overrides: Partial<ChatAgentTask> = {}): ChatAgentTask {
  return {
    task_id: taskID, type: 'ORCHESTRATOR_TASK', source: 'orchestrator', project_id: '/project/a', chat_id: `chat-${taskID}`, session_id: 'session-current',
    request_id: '', root_request_id: '', conversation_id: '', parent_task_id: '', title: taskID, description: `Descrição ${taskID}`, priority: 0, status,
    not_before: '2026-09-28T05:00:00Z', attempt: 0, max_attempts: 3, dedupe_key: '', assigned_worker: '', keep_flowing: false, lease_owner: '',
    payload: {}, last_error: '', created_at: '2026-09-28T05:00:00Z', updated_at: '2026-09-28T05:00:00Z', ...overrides,
  }
}

function renderDrawer(onGoToChat?: (chatId?: string, sessionId?: string) => void) {
  return render(<ProjectTasksDrawer projectPath="/project/a" chats={[]} savedChats={[]} archivedChats={[]} currentSession={currentSession} activeChatId="" activeEvents={[]} onClose={() => undefined} onGoToChat={onGoToChat}/>)
}

function historyCalls() {
  return mocks.projectTasks.mock.calls.filter(([, options]) => options?.scope === 'history')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ProjectTaskCardShell', () => {
  it('uses the Tailwind card surface and exposes status hierarchy', () => {
    const view = render(<ProjectTaskCardShell disposition="queue" failed={false} source="chat" sourceLabel="Chat" sourceIcon={<span>AI</span>} stateLabel="Na fila" title="Melhorar cartões" updatedAt="2026-09-24T19:00:00Z" updatedLabel="24/09, 19:00" prompt="Resumo legível da tarefa" rootRequestId="req_123" metadata={<span>2 requisições GPT</span>} renderDetails={() => <div>Detalhes</div>}/>)
    const card = view.container.querySelector('[data-project-task-card]')

    expect(card?.className).toContain('rounded-xl')
    expect(card?.className).toContain('border-whx-border-soft')
    expect(card?.className).toContain('h-auto')
    expect(card?.className).toContain('self-start')
    expect(card?.className).toContain('content-start')
    expect(card?.className).not.toContain('overflow-hidden')
    expect(view.getByText('Na fila').className).toContain('text-whx-warning')
    expect(view.getByText('Resumo legível da tarefa').className).toContain('bg-whx-bg')
  })

  it('keeps long task context readable without horizontal pressure', () => {
    const title = 'Reestruturar o cartão de tarefa com um título suficientemente longo para precisar de duas linhas legíveis'
    const prompt = 'Primeira linha do resumo com contexto útil. Segunda linha com detalhes operacionais. Terceira linha ainda legível. Quarta linha deve ficar limitada pela prévia.'
    const requestId = 'req_20260927T195701_4ea09202f147a886_with_an_extra_long_identifier_segment'
    const metadata = 'Worker: worker-with-an-extraordinarily-long-runtime-identifier-that-must-wrap'
    const view = render(<ProjectTaskCardShell disposition="completed" failed={false} source="orchestrator" sourceLabel="Orchestrator" sourceIcon={<span>AI</span>} stateLabel="Concluída" title={title} updatedAt="2026-09-27T19:57:14Z" updatedLabel="27/09, 19:57" prompt={prompt} rootRequestId={requestId} metadata={<span>{metadata}</span>} renderDetails={() => <div>Detalhes</div>}/>)

    const heading = view.getByText(title)
    const preview = view.getByText(prompt)
    const request = view.getByText(requestId)
    const meta = view.getByText(metadata)
    const header = heading.closest('header')
    const chrome = header?.firstElementChild
    const timestamp = view.getByText('27/09, 19:57')

    expect(header?.className).toContain('grid')
    expect(chrome?.className).toContain('flex-wrap')
    expect(timestamp.className).toContain('whitespace-nowrap')
    expect(heading.className).not.toContain('truncate')
    expect(heading.className).toContain('[-webkit-line-clamp:2]')
    expect(heading.className).toContain('[overflow-wrap:anywhere]')
    expect(preview.className).toContain('[-webkit-line-clamp:3]')
    expect(preview.className).toContain('[overflow-wrap:anywhere]')
    expect(request.className).toContain('break-all')
    expect(meta.parentElement?.className).toContain('[&>span]:break-words')
  })

  it('keeps list scrolling outside intrinsic-height task cards', () => {
    const view = render(<ProjectTaskListPanel><span>Tarefa</span></ProjectTaskListPanel>)
    const panelClasses = view.getByRole('tabpanel').className

    expect(panelClasses).toContain('auto-rows-max')
    expect(panelClasses).toContain('content-start')
    expect(panelClasses).toContain('items-start')
    expect(panelClasses).toContain('overflow-y-auto')
    expect(panelClasses).toContain('overflow-x-hidden')
  })

  it('removes the migrated legacy project task selectors', () => {
    expect(legacyCss).not.toMatch(/\.project-task-card(?:[\s.{:#]|$)/)
    expect(legacyCss).not.toMatch(/\.project-task-list(?:[\s.{:#]|$)/)
  })
})

describe('ProjectTasksDrawer progressive loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executionConcurrency.mockResolvedValue({ concurrency: 1, max: 2 })
    mocks.updateExecutionConcurrency.mockResolvedValue({ concurrency: 1, max: 2 })
    mocks.getSession.mockResolvedValue({ ...currentSession, id: 'session-history' })
    mocks.eventHistory.mockResolvedValue({ events: [] })
    mocks.orchestratorTaskRuns.mockResolvedValue({ runs: [] })
    mocks.chatAgentTaskEvents.mockResolvedValue({ events: [] })
  })

  it('loads only active tasks on mount and polling never reloads history', async () => {
    vi.useFakeTimers()
    mocks.projectTasks.mockImplementation(async (_projectPath: string, options: { scope: string }) => options.scope === 'active'
      ? { tasks: [task('active-task', 'PENDING')] }
      : { tasks: [task('completed-task', 'DONE')], has_more: false })
    const view = renderDrawer()
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(screen.getByText('active-task', { selector: 'strong' })).toBeTruthy()
      expect(historyCalls()).toHaveLength(0)

      await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); await Promise.resolve() })
      expect(mocks.projectTasks.mock.calls.filter(([, options]) => options?.scope === 'active')).toHaveLength(2)
      expect(historyCalls()).toHaveLength(0)

      fireEvent.click(screen.getByRole('tab', { name: /Concluídas/ }))
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(screen.getByText('completed-task', { selector: 'strong' })).toBeTruthy()
      expect(historyCalls()).toHaveLength(1)

      await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); await Promise.resolve() })
      expect(historyCalls()).toHaveLength(1)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps history pages cached, appends without duplicates, and handles archived error then empty retry', async () => {
    const nextPage = deferred<{ tasks: ChatAgentTask[]; has_more: boolean; next_cursor?: string }>()
    let historyRequest = 0
    mocks.projectTasks.mockImplementation(async (_projectPath: string, options: { scope: string; cursor?: string }) => {
      if (options.scope === 'active') return { tasks: [] }
      historyRequest += 1
      if (historyRequest === 1) return { tasks: [task('completed-one', 'DONE')], has_more: true, next_cursor: 'cursor-2' }
      if (historyRequest === 2) return nextPage.promise
      if (historyRequest === 3) throw new Error('histórico indisponível')
      return { tasks: [], has_more: false }
    })
    renderDrawer()

    fireEvent.click(screen.getByRole('tab', { name: /Concluídas/ }))
    expect(await screen.findByText('completed-one', { selector: 'strong' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Carregar mais concluídas/ }))
    expect(screen.getByText('completed-one', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByLabelText('A carregar mais tarefas')).toBeTruthy()
    nextPage.resolve({ tasks: [task('completed-one', 'DONE'), task('completed-two', 'DONE', { updated_at: '2026-09-28T04:00:00Z' })], has_more: false })
    await waitFor(() => expect(screen.getByText('completed-two', { selector: 'strong' })).toBeTruthy())
    expect(screen.getAllByText('completed-one', { selector: 'strong' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: /Arquivadas/ }))
    expect(await screen.findByText('histórico indisponível')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/ }))
    expect(await screen.findByText('Nenhuma tarefa arquivada.')).toBeTruthy()

    const callsAfterRetry = historyCalls().length
    fireEvent.click(screen.getByRole('tab', { name: /Em curso/ }))
    expect(await screen.findByText('Nenhuma tarefa em curso.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Concluídas/ }))
    expect(screen.getByText('completed-one', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText('completed-two', { selector: 'strong' })).toBeTruthy()
    expect(historyCalls()).toHaveLength(callsAfterRetry)
  })

  it('keeps Main Request grouping, navigation, and session details lazy', async () => {
    const root = task('request-root', 'PENDING', {
      type: 'AWAIT_RESPONSE', source: 'chat', chat_id: 'chat-request', session_id: 'session-history', request_id: 'req-root', root_request_id: 'req-root', payload: { original_prompt: 'Pedido principal' },
    })
    const child = task('request-child', 'WAITING', { ...root, task_id: 'request-child', request_id: 'req-child', status: 'WAITING', payload: {} })
    const onGoToChat = vi.fn()
    mocks.projectTasks.mockResolvedValue({ tasks: [root, child] })
    renderDrawer(onGoToChat)
    expect(await screen.findByText('Pedido principal')).toBeTruthy()
    expect(screen.getByText('2 requisições GPT')).toBeTruthy()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.eventHistory).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Ver chat' }))
    expect(onGoToChat).toHaveBeenCalledWith('chat-request', 'session-history')
    fireEvent.click(screen.getByText('Detalhes, planos, execuções, logs e metadados'))
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledWith('session-history'))
    await waitFor(() => expect(mocks.eventHistory).toHaveBeenCalledWith('session-history', true))
  })
})
