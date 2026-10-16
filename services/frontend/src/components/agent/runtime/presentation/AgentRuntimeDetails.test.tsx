import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentRuntimeDetails } from './AgentRuntimeDetails'

function agent(): DesktopAgentRuntimeAgent {
  return {
    id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', draining: false,
    chat_id: 'chat-1', error: '', loop_active: true,
    task: {
      task_id: 'task-1', type: 'AWAIT_RESPONSE', chat_id: 'chat-1', project_id: '/projects/alpha',
      request_id: 'req-1', root_request_id: 'root-1', conversation_id: 'conversation-1', status: 'RUNNING',
      attempt: 2, max_attempts: 30, assigned_worker: '', keep_flowing: false,
      lease_expires_at: '2026-10-15T10:00:00Z', not_before: '2026-10-15T09:00:00Z', last_error: '',
      created_at: '', updated_at: '',
    },
    last_claim_at: '2026-10-15T09:00:00Z',
    residency: { slot_id: 'slot-1', resident_lane: 'lane-1', resident_since: '2026-10-15T08:00:00Z', min_resident_until: '2026-10-15T10:00:00Z', assignment_epoch: 7, rotation_position: 0, navigation_in_progress: true, non_preemptive: true },
    activity: { phase: 'processing', since: '2026-10-15T09:30:00Z', task_id: 'task-1' },
    browser: { available: true, web_contents_id: 11, os_process_id: 2011, url: 'https://chatgpt.com/c/1', title: 'Chat do projeto', loading: false },
    memory: { available: true, rss_bytes: 340 * 1024 * 1024, os_process_id: 2011, shared_process: false },
  }
}

describe('AgentRuntimeDetails', () => {
  it('presents foreign project ownership as a readable status without legacy styling', () => {
    const { container } = render(<AgentRuntimeDetails agent={agent()} projectPath="/projects/beta" projectName="alpha" foreignProject="/projects/alpha" projectId="/projects/alpha" taskIsCurrent stateLabel="Ocupado noutro projeto"/> )
    const note = screen.getByRole('status')
    expect(note.textContent).toContain('Ocupado com uma tarefa do projeto alpha')
    expect(note.className).toContain('text-[calc(13px*var(--ui-font-scale))]')
    expect(note.className).not.toContain('agent-runtime-foreign-note')
    expect(container.querySelector('details')).toBeNull()
  })

  it('keeps operational facts visible and reveals complete execution diagnostics on demand', () => {
    const onGoToChat = vi.fn()
    const { container } = render(<AgentRuntimeDetails agent={agent()} projectPath="/projects/alpha" projectName="alpha" projectId="/projects/alpha" chat={{ id: 'chat-1', title: 'Refatorar parser', sessionId: 'session-1' }} task={agent().task} taskIsCurrent stateLabel="A escutar" onGoToChat={onGoToChat}/> )

    expect(screen.getByText('RUNNING')).toBeTruthy()
    expect(screen.getByText('340 MiB')).toBeTruthy()
    expect(screen.getByText('WebContents #11 · PID 2011')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Atividade' }).textContent).toContain('AWAIT_RESPONSE')
    expect(screen.getByRole('region', { name: 'Atividade' }).textContent).toContain('Estado da tarefa')
    expect(screen.getByRole('region', { name: 'Sessão' }).textContent).toContain('Refatorar parser')
    expect(screen.getByRole('region', { name: 'Instância' }).textContent).toContain('WebContents #11')
    const diagnostics = container.querySelector('details')
    expect(diagnostics?.open).toBe(false)
    expect(screen.getByText('root-1').closest('details')).toBe(diagnostics)

    fireEvent.click(screen.getByText('Detalhes da execução'))
    expect(diagnostics?.open).toBe(true)
    expect(screen.getByText('req-1')).toBeTruthy()
    expect(screen.getByText('root-1')).toBeTruthy()
    expect(screen.getByText('conversation-1')).toBeTruthy()
    expect(screen.getByText('2/30')).toBeTruthy()
    expect(screen.getByText('Lease')).toBeTruthy()
    expect(screen.getByText('root-1').className).toContain('[overflow-wrap:anywhere]')
    expect(screen.getByText('root-1').className).toContain('select-text')
    expect(screen.getByText('root-1').className).not.toContain('truncate')
    expect(screen.getByText(/lane-1 · rotação #1/)).toBeTruthy()
    expect(screen.getByText(/7 · a navegar · não preemptível/)).toBeTruthy()
    expect(screen.getByText('Fase desde')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir o chat Refatorar parser' }))
    expect(onGoToChat).toHaveBeenCalledWith('chat-1', 'session-1')
  })

  it('keeps a long runtime error readable instead of truncating it into the state row', () => {
    const instance = { ...agent(), error: 'Falha de ligação: a sessão foi encerrada antes da validação final. Confirme a conta e tente novamente.' }
    render(<AgentRuntimeDetails agent={instance} projectPath="/projects/alpha" projectName="alpha" projectId="/projects/alpha" taskIsCurrent stateLabel="Com erro"/> )

    const diagnostic = screen.getByRole('status', { name: 'Diagnóstico do agente' })
    expect(diagnostic.textContent).toContain(instance.error)
    expect(diagnostic.querySelector('span')?.className).toContain('[overflow-wrap:anywhere]')
    expect(screen.getByText('Com erro')).toBeTruthy()
  })
})
