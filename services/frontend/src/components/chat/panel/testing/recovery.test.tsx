import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('offers reprocessing for a persisted policy-blocked notice', async () => {
    const onReprocessPolicyBlock = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[{ id: 'policy-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Bundle bloqueado pela Policy antes da execução.', meta: 'Policy bloqueada' }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onReprocessPolicyBlock={onReprocessPolicyBlock} canReprocessPolicyBlock {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reprocessar' }))
    await waitFor(() => expect(onReprocessPolicyBlock).toHaveBeenCalledOnce())
  })

it('offers a fresh request after a terminal remote protocol failure', async () => {
    const onRetryTransportFailure = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[{ id: 'protocol-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Bundle recusado pela validação.', meta: 'Falha de protocolo · pedido pode ser repetido', iteration: { id: 'iteration-1', requestId: 'req-123', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onRetryTransportFailure={onRetryTransportFailure} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retomar pedido' }))
    await waitFor(() => expect(onRetryTransportFailure).toHaveBeenCalledWith('req-123'))
  })

it('offers manual GPT correction on a repairable failure with optional operator guidance', async () => {
    const onRepairWithGPT = vi.fn(async () => undefined)
    render(
      <ChatPanel session={{ ...session, state: 'failed', last_repair_error: 'tests still fail' }} items={[{ id: 'failure-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'A execução falhou.', meta: 'Execução falhou', iteration: { id: 'iteration-failure', requestId: 'req-failure', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} canRepairWithGPT onRepairWithGPT={onRepairWithGPT} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir com GPT' }))
    const detail = await screen.findByRole('textbox', { name: 'Detalhe opcional' })
    fireEvent.change(detail, { target: { value: 'Considere o fixture Windows.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para correção' }))
    await waitFor(() => expect(onRepairWithGPT).toHaveBeenCalledWith('Considere o fixture Windows.'))
  })

it('requires new operator evidence before retrying a planner-declared non-retryable failure', async () => {
    const onRepairWithGPT = vi.fn(async () => undefined)
    const missingEvidence = {
      ...session,
      state: 'failed',
      last_request_id: 'req-missing-evidence',
      last_repair_error: 'Planner reported failed: missing_primary_build_failure',
      last_turn: {
        protocol: 'harness.turn/v1' as const,
        request_id: 'req-missing-evidence',
        kind: 'blocked' as const,
        message: 'The primary build failure is missing.',
        outcome: { status: 'failed' as const, reason_code: 'missing_primary_build_failure', retryable: false },
      },
    }
    render(
      <ChatPanel session={missingEvidence} items={[{ id: 'failure-missing-evidence', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Falta o erro primário do build.', meta: 'Pedido bloqueado', iteration: { id: 'iteration-missing-evidence', requestId: 'req-missing-evidence', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} canRepairWithGPT onRepairWithGPT={onRepairWithGPT} {...chatActions} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Corrigir com GPT' }))
    const evidence = await screen.findByRole('textbox', { name: 'Evidência ou orientação necessária' })
    expect(evidence.tagName).toBe('TEXTAREA')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar nova evidência' }))

    expect(await screen.findByText('Acrescente a evidência ou orientação que mudou desde a última tentativa.')).toBeTruthy()
    expect(onRepairWithGPT).not.toHaveBeenCalled()

    fireEvent.change(evidence, { target: { value: 'ERROR: npm run build falhou em packages/admin.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar nova evidência' }))
    await waitFor(() => expect(onRepairWithGPT).toHaveBeenCalledWith('ERROR: npm run build falhou em packages/admin.'))
  })

it('withdraws the bare resume from a planner-declared non-retryable failure and keeps the guided repair', () => {
    const onRetryTransportFailure = vi.fn(async () => undefined)
    const missingEvidence = {
      ...session,
      state: 'failed',
      last_request_id: 'req-missing-evidence',
      last_repair_error: 'Planner reported failed: missing_primary_build_failure',
      last_turn: {
        protocol: 'harness.turn/v1' as const,
        request_id: 'req-missing-evidence',
        kind: 'blocked' as const,
        message: 'The primary build failure is missing.',
        outcome: { status: 'failed' as const, reason_code: 'missing_primary_build_failure', retryable: false },
      },
    }
    render(
      <ChatPanel session={missingEvidence} items={[{ id: 'failure-missing-evidence', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Falta o erro primário do build.', meta: 'Pedido não concluído · requer intervenção', iteration: { id: 'iteration-missing-evidence', requestId: 'req-missing-evidence', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} canRepairWithGPT onRepairWithGPT={async () => undefined} onRetryTransportFailure={onRetryTransportFailure} {...chatActions} />,
    )

    expect(screen.queryByRole('button', { name: 'Retomar pedido' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Corrigir com GPT' })).toBeTruthy()
  })

it('keeps the bare resume when the planner reported the same failure as retryable', () => {
    const onRetryTransportFailure = vi.fn(async () => undefined)
    const retryable = {
      ...session,
      state: 'failed',
      last_request_id: 'req-retryable',
      last_repair_error: 'Planner reported failed: transient_provider_error',
      last_turn: {
        protocol: 'harness.turn/v1' as const,
        request_id: 'req-retryable',
        kind: 'blocked' as const,
        message: 'Transient provider error.',
        outcome: { status: 'failed' as const, reason_code: 'transient_provider_error', retryable: true },
      },
    }
    render(
      <ChatPanel session={retryable} items={[{ id: 'failure-retryable', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Falha transitória.', meta: 'Pedido não concluído · pode ser repetido', iteration: { id: 'iteration-retryable', requestId: 'req-retryable', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onRetryTransportFailure={onRetryTransportFailure} {...chatActions} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retomar pedido' }))
    expect(onRetryTransportFailure).toHaveBeenCalledWith('req-retryable')
  })

it('puts the restricted dependency recovery beside its expanded failure', async () => {
    const onRetryDependencyNetwork = vi.fn(async () => undefined)
    render(
      <ChatPanel session={{ ...session, state: 'failed', failure_kind: 'offline_go_module_cache', last_repair_error: 'module lookup disabled by GOPROXY=off' }} items={[{ id: 'dependency-failure', role: 'harness', source: 'wharness', presentation: 'notice', text: 'A execução falhou.', meta: 'Execução falhou', iteration: { id: 'iteration-dependency', requestId: 'req-dependency', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} canRetryDependencyNetwork onRetryDependencyNetwork={onRetryDependencyNetwork} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Permitir rede e repetir' }))
    await waitFor(() => expect(onRetryDependencyNetwork).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Corrigir com GPT' })).toBeNull()
  })

it('timestamps WHX notices, links their request, and allows cancelling the active request', async () => {
    const onCancelPendingRequest = vi.fn(async () => undefined)
    render(<ChatPanel session={{ ...session, state: 'awaiting_plan', last_request_id: 'req-123', pending_manual_request_ids: ['req-123'] }} items={[{ id: 'failure', role: 'harness', source: 'wharness', presentation: 'notice', createdAt: '2026-09-06T11:00:00Z', text: 'Falhou.', iteration: { id: 'iteration-1', requestId: 'req-123', phase: 'failed', artifacts: [] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onCancelPendingRequest={onCancelPendingRequest} {...chatActions} />)
    expect(screen.getByText('WHX')).toBeTruthy()
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-06T11:00:00Z')
    expect(screen.getByRole('link', { name: 'Pedido req-123' }).getAttribute('href')).toBe('#request-req-123')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    await waitFor(() => expect(onCancelPendingRequest).toHaveBeenCalledWith('req-123'))
  })

it('does not allow an old failed request to be repeated while another request is active', () => {
    render(
      <ChatPanel session={{ ...session, pending_manual_request_ids: ['req-new'], state: 'awaiting_plan' }} items={[{ id: 'protocol-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Bundle recusado pela validação.', meta: 'Falha de protocolo · pedido pode ser repetido', iteration: { id: 'iteration-1', requestId: 'req-old', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} taskInFlight onSend={async () => undefined} onRetryTransportFailure={async () => undefined} {...chatActions} />,
    )
    expect((screen.getByRole('button', { name: 'Retomar pedido' }) as HTMLButtonElement).disabled).toBe(true)
  })

it('offers to resend a request that is still pending, so a silently failed auto-delivery can be retried', async () => {
    const onResendPendingRequest = vi.fn(async () => undefined)
    render(
      <ChatPanel session={{ ...session, pending_manual_request_ids: ['req-new'], state: 'awaiting_plan' }} items={[{ id: 'auto-recovery-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'O pedido de correção automática foi preparado no ChatGPT.', meta: 'Pedido req-new · confirmação pendente', iteration: { id: 'iteration-2', requestId: 'req-new', phase: 'prepared', artifacts: ['context', 'prompt'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onResendPendingRequest={onResendPendingRequest} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar request' }))
    await waitFor(() => expect(onResendPendingRequest).toHaveBeenCalledWith('req-new'))
  })

it('does not offer same-request resend after a terminal planner failure bundle', () => {
    render(
      <ChatPanel session={{ ...session, last_request_id: 'req-failed', pending_manual_request_ids: [], state: 'failed' }} items={[{ id: 'failed-result-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'O planner não concluiu o pedido.', meta: 'Pedido não concluído · pode ser repetido', iteration: { id: 'iteration-failed', requestId: 'req-failed', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onRetryTransportFailure={async () => undefined} onResendPendingRequest={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByRole('button', { name: 'Retomar pedido' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reenviar request' })).toBeNull()
  })

it('does not offer to resend a notice whose request has already been superseded', () => {
    render(
      <ChatPanel session={{ ...session, pending_manual_request_ids: ['req-new'], state: 'awaiting_plan' }} items={[{ id: 'auto-recovery-old', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Recuperação automática preparada.', meta: 'Recuperação automática preparada · req-new', iteration: { id: 'iteration-3', requestId: 'req-old', phase: 'failed', artifacts: ['error'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onResendPendingRequest={async () => undefined} {...chatActions} />,
    )
    expect(screen.queryByRole('button', { name: 'Reenviar request' })).toBeNull()
  })

it('disables the resend action while a newer request is already in flight', () => {
    render(
      <ChatPanel session={{ ...session, last_request_id: 'req-new', state: 'awaiting_plan' }} items={[{ id: 'auto-recovery-2', role: 'harness', source: 'wharness', presentation: 'notice', text: 'O pedido de correção automática foi enviado ao ChatGPT em segundo plano.', meta: 'Pedido req-new enviado automaticamente', iteration: { id: 'iteration-4', requestId: 'req-new', phase: 'submitted', artifacts: ['context', 'prompt'] } }]} chats={[]} activeChatId="" busy={false} taskInFlight onSend={async () => undefined} onResendPendingRequest={async () => undefined} {...chatActions} />,
    )
    expect((screen.getByRole('button', { name: 'Reenviar request' }) as HTMLButtonElement).disabled).toBe(true)
  })

it('also allows cancelling a request that is only listed in pending_manual_request_ids, not just last_request_id', async () => {
    const onCancelPendingRequest = vi.fn(async () => undefined)
    render(
      <ChatPanel session={{ ...session, pending_manual_request_ids: ['req-new'], state: 'awaiting_plan' }} items={[{ id: 'auto-recovery-3', role: 'harness', source: 'wharness', presentation: 'notice', text: 'O pedido de correção automática foi preparado no ChatGPT.', meta: 'Pedido req-new · confirmação pendente', iteration: { id: 'iteration-5', requestId: 'req-new', phase: 'prepared', artifacts: ['context', 'prompt'] } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onCancelPendingRequest={onCancelPendingRequest} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }))
    await waitFor(() => expect(onCancelPendingRequest).toHaveBeenCalledWith('req-new'))
  })

it('offers reprocessing in the message footer used by older imported bundles', async () => {
    const onReprocessPolicyBlock = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[{ id: 'policy-footer', role: 'harness', source: 'chatgpt', text: 'Bundle ZIP importado e plano validado.', meta: 'Bundle wharness-bundle.zip · Policy bloqueada' }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onReprocessPolicyBlock={onReprocessPolicyBlock} canReprocessPolicyBlock {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reprocessar' }))
    await waitFor(() => expect(onReprocessPolicyBlock).toHaveBeenCalledOnce())
  })
})
