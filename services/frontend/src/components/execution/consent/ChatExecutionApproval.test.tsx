import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '../../../types'
import { ChatExecutionApproval } from './ChatExecutionApproval'
import { ExecutionConsentAction } from './ExecutionConsentAction'

afterEach(cleanup)
function session(): Session {
  return { id: 'ses-approval', project_path: '/workspace/project', state: 'planned', execution_mode: 'protected', automation_mode: 'manual', created_at: '2026-10-09T00:00:00Z', context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/project', sha256: 'a', files: [], excluded: [], text_truncated: false } }, plan: { protocol: 'harness.execution/v1', plan_id: 'plan-approval', request_id: 'req-approval', summary: 'Verificar projeto', document: 'Contrato informado', status: 'ready', risk: 'high', requires_approval: true, operations: [{ type: 'command', command: { argv: ['go', 'test', './...'], cwd: '.', timeout_seconds: 60, network: false, expected_exit_codes: [0], rationale: 'Verificação' } }], verification: [] }, policy: { allowed: true, requires_approval: true, risk: 'high', reasons: [] } }
}

describe('in-chat execution consent', () => {
  it('shows exact commands before a human click and invokes existing execution handler once', async () => {
    const onExecute = vi.fn(async () => undefined)
    render(<ChatExecutionApproval session={session()} busy={false} onExecute={onExecute}/>)
    expect(screen.getByText('["go","test","./..."]')).toBeTruthy()
    expect(screen.getByText(/integração no host após verificação/)).toBeTruthy()
    expect(onExecute).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e executar no chat' }))
    await waitFor(() => expect(onExecute).toHaveBeenCalledWith(true, ''))
    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  it('uses exact debug approval action with rationale, target, scope and capability visible', async () => {
    const current = session()
    current.state = 'debug_approval_required'; current.last_turn = { protocol: 'harness.turn/v1', request_id: 'req-approval', kind: 'workflow', message: 'Evidência' }
    current.plan!.debug = { protocol: 'harness.interactive/v2', target: 'host', access: 'observe', rationale: 'Examinar PostgreSQL', capabilities: ['container'], scope: { containers: ['database'] } }
    const onExecute = vi.fn(async () => undefined); const onApproveDebug = vi.fn(async () => undefined)
    render(<ChatExecutionApproval session={current} busy={false} onExecute={onExecute} onApproveDebug={onApproveDebug}/>)
    expect(screen.getByText(/Examinar PostgreSQL/)).toBeTruthy()
    expect(screen.getByText(/"database"/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Autorizar Interactive v2/ }))
    await waitFor(() => expect(onApproveDebug).toHaveBeenCalledTimes(1))
    expect(onExecute).not.toHaveBeenCalled()
  })

  it('never offers successful, interrupted, policy-denied or workflow execution as ordinary approval', () => {
    for (const edit of [(s: Session) => { s.state = 'applied' }, (s: Session) => { s.policy!.allowed = false }, (s: Session) => { s.last_turn = { protocol: 'harness.turn/v1', request_id: 'req-approval', kind: 'workflow', message: '' } }]) {
      const current = session(); edit(current)
      const view = render(<ChatExecutionApproval session={current} busy={false} onExecute={vi.fn()}/>)
      expect(screen.queryByRole('button', { name: 'Aceitar e executar no chat' })).toBeNull(); view.unmount()
    }
  })

  it('prevents duplicate human clicks while awaiting backend and clears ephemeral sudo', async () => {
    const current = session(); current.execution_mode = 'full'
    current.policy!.approval_items = [{ kind: 'sudo', argv: ['sudo', 'true'], effect: 'Executar comando', host_impact: 'Host', requires_sudo_password: true }]
    let finish: (() => void) | undefined
    const onExecute = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const clear = vi.fn()
    render(<ExecutionConsentAction session={current} busy={false} sudoPassword="ephemeral" onClearPassword={clear} onExecute={onExecute}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar sudo e executar' })); fireEvent.click(screen.getByRole('button', { name: 'A autorizar…' }))
    expect(onExecute).toHaveBeenCalledTimes(1); expect(onExecute).toHaveBeenCalledWith(true, 'ephemeral')
    finish?.(); await waitFor(() => expect(clear).toHaveBeenCalledOnce())
  })
})
