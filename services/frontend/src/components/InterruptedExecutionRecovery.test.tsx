import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { InterruptedExecutionRecovery, type InterruptedExecutionTarget } from './InterruptedExecutionRecovery'

function target(status: NonNullable<Session['interrupted_execution']>['status'] = 'awaiting_decision'): InterruptedExecutionTarget {
  const session: Session = {
    id: 'ses-recovery', project_path: '/workspace/wharness', state: 'planned', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-07T10:00:00.000Z',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
    interrupted_execution: { plan_id: 'plan-recovery', requested_at: '2026-09-07T10:15:00.000Z', approved: false, status },
  }
  return { chat: { id: 'chat-1', title: 'Principal', sessionId: session.id, createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z' }, session }
}

describe('InterruptedExecutionRecovery', () => {
  it('is a non-modal recovery center with independent navigation and decision actions', () => {
    const item = target()
    const onDecision = vi.fn()
    const onOpenChat = vi.fn()
    const onOpenLogs = vi.fn()
    const { container } = render(<InterruptedExecutionRecovery items={[item]} busyChats={{}} onDecision={onDecision} onOpenChat={onOpenChat} onOpenLogs={onOpenLogs} onOpenChatGPT={vi.fn()}/>)
    const center = container.querySelector('.execution-recovery-center')
    expect(center?.getAttribute('data-chatgpt-overlay-blocker')).toBe('true')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Aguardando decisão')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat' }))
    fireEvent.click(screen.getByRole('button', { name: /Ver logs/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }))
    expect(onOpenChat).toHaveBeenCalledWith(item)
    expect(onOpenLogs).toHaveBeenCalledWith(item)
    expect(onDecision).toHaveBeenCalledWith(item, 'continue')
    fireEvent.click(screen.getByRole('button', { name: 'Recolher centro de recuperação' }))
    expect(center?.hasAttribute('data-chatgpt-overlay-blocker')).toBe(false)
  })

  it('surfaces human intervention and keeps execution decisions disabled while resume is active', () => {
    const item = target('resuming')
    item.humanAction = { cacheKey: 'chat-1', active: true, kind: 'verification', message: 'Conclua a verificação.', detectedAt: '2026-09-07T10:16:00.000Z' }
    const onOpenChatGPT = vi.fn()
    render(<InterruptedExecutionRecovery items={[item]} busyChats={{}} onDecision={vi.fn()} onOpenChat={vi.fn()} onOpenLogs={vi.fn()} onOpenChatGPT={onOpenChatGPT}/>)
    expect(screen.getByText('Ação humana necessária')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Abrir ChatGPT/ }))
    expect(onOpenChatGPT).toHaveBeenCalledWith(item)
    expect((screen.getByRole('button', { name: 'Descartar' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /A acompanhar/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('requires the ephemeral sudo password again before resuming a sudo execution', () => {
    const item = target()
    item.session.execution_mode = 'full'
    item.session.policy = { allowed: true, requires_approval: true, risk: 'high', reasons: [], approval_items: [{ kind: 'sudo', argv: ['sudo', 'systemctl', 'restart', 'demo.service'], effect: 'restart service', host_impact: 'host service', requires_sudo_password: true }] }
    const onDecision = vi.fn()
    render(<InterruptedExecutionRecovery items={[item]} busyChats={{}} onDecision={onDecision} onOpenChat={vi.fn()} onOpenLogs={vi.fn()} onOpenChatGPT={vi.fn()}/>)
    const resume = screen.getByRole('button', { name: /Continuar/ }) as HTMLButtonElement
    expect(resume.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Introduza novamente'), { target: { value: 'temporary-secret' } })
    expect(resume.disabled).toBe(false)
    fireEvent.click(resume)
    expect(onDecision).toHaveBeenCalledWith(item, 'continue', 'temporary-secret')
    expect((screen.getByPlaceholderText('Introduza novamente') as HTMLInputElement).value).toBe('')
  })

})
