import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from './ChatPanel'
import type { Session } from '../types'
import { clearEphemeralComposerDrafts } from '../lib/workspaceMemory'

const session = {
  id: 'ses-test',
  project_path: '/tmp/demo',
  state: 'ready',
  execution_mode: 'protected',
  automation_mode: 'manual',
  created_at: new Date().toISOString(),
  context: {
    id: 'ctx-test',
    manifest: {
      id: 'ctx-test',
      project_root: '/tmp/demo',
      sha256: 'abcdef1234567890',
      files: [],
      excluded: [],
      text_truncated: false,
    },
  },
} satisfies Session

const chatActions = {
  archivedChats: [],
  onNewChat: async () => undefined,
  onSelectChat: async () => undefined,
  onArchiveChat: async () => undefined,
  onRestoreChat: async () => undefined,
  onDeleteArchivedChat: async () => undefined,
}

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); vi.restoreAllMocks(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

  it('positions the initial transcript at the latest messages without smooth scrolling', () => {
    const scrollIntoView = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' })
    expect(() => view.unmount()).not.toThrow()
  })


  it('keeps isolated-context metadata in the header instead of repeating it in the transcript', () => {
    const view = render(
      <ChatPanel session={{ ...session, context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'README.md', size: 12, sha256: 'abc' }] } } }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const context = view.container.querySelector('.chat-header-context')
    expect(context?.textContent).toContain('Contexto isolado')
    expect(context?.textContent).toContain('1 ficheiros · abcdef123456')
    expect(view.container.querySelector('.chat-stream .system-note')).toBeNull()
  })

  it('removes redundant chat labels from the header while keeping the title in the switcher', () => {
    const now = new Date().toISOString()
    const chat = { id: 'chat-1', title: 'Nome de chat', sessionId: session.id, createdAt: now, updatedAt: now }
    const view = render(
      <ChatPanel session={session} items={[]} chats={[chat]} activeChatId={chat.id} busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const header = view.container.querySelector('.chat-header')
    expect(header?.firstElementChild?.classList.contains('chat-header-context')).toBe(true)
    expect(header?.textContent).not.toContain('Harness chat')
    expect(header?.textContent).not.toContain('Nome de chat')
    expect(screen.getByText('Nome de chat')).toBeTruthy()
  })


  it('renders only the latest transcript window and loads older messages when scrolling upward', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `history-${index + 1}`, role: 'user' as const, text: `mensagem ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="history-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(screen.queryByText('mensagem 1')).toBeNull()
    expect(screen.getByText('mensagem 25')).toBeTruthy()
    expect(screen.getByText('5 mensagem(ns) anterior(es)')).toBeTruthy()

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 0
    fireEvent.scroll(stream)

    await waitFor(() => expect(screen.getByText('mensagem 1')).toBeTruthy())
    expect(screen.queryByText('5 mensagem(ns) anterior(es)')).toBeNull()
  })


  it('restores independent viewport positions and loaded history when switching chats', async () => {
    const chatAItems = Array.from({ length: 45 }, (_, index) => ({ id: `chat-a-${index + 1}`, role: 'user' as const, text: `chat A mensagem ${index + 1}` }))
    const chatBItems = Array.from({ length: 12 }, (_, index) => ({ id: `chat-b-${index + 1}`, role: 'user' as const, text: `chat B mensagem ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={chatAItems} chats={[]} activeChatId="chat-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 0
    fireEvent.scroll(stream)

    await waitFor(() => expect(screen.getByText('chat A mensagem 6')).toBeTruthy())
    expect(screen.queryByText('chat A mensagem 1')).toBeNull()

    stream.scrollTop = 320
    fireEvent.scroll(stream)
    view.rerender(
      <ChatPanel session={session} items={chatBItems} chats={[]} activeChatId="chat-b" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    stream.scrollTop = 140
    fireEvent.scroll(stream)
    const chatAWithNewActivity = [...chatAItems, { id: 'chat-a-46', role: 'harness' as const, text: 'chat A mensagem 46' }]
    view.rerender(
      <ChatPanel session={session} items={chatAWithNewActivity} chats={[]} activeChatId="chat-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(stream.scrollTop).toBe(320)
    expect(screen.getByText('chat A mensagem 6')).toBeTruthy()
    expect(screen.getByText('chat A mensagem 46')).toBeTruthy()

    view.rerender(
      <ChatPanel session={session} items={chatBItems} chats={[]} activeChatId="chat-b" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(stream.scrollTop).toBe(140)
  })

  it('returns to the newest transcript window when a chat was left following the tail', () => {
    const scrollIntoView = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const chatAItems = Array.from({ length: 25 }, (_, index) => ({ id: `tail-a-${index + 1}`, role: 'user' as const, text: `tail A mensagem ${index + 1}` }))
    const chatBItems = [{ id: 'tail-b-1', role: 'user' as const, text: 'tail B mensagem 1' }]
    const view = render(
      <ChatPanel session={session} items={chatAItems} chats={[]} activeChatId="tail-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 400 })
    stream.scrollTop = 600
    fireEvent.scroll(stream)

    view.rerender(
      <ChatPanel session={session} items={chatBItems} chats={[]} activeChatId="tail-b" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const chatAWithNewActivity = [...chatAItems, { id: 'tail-a-26', role: 'harness' as const, text: 'tail A mensagem 26' }]
    view.rerender(
      <ChatPanel session={session} items={chatAWithNewActivity} chats={[]} activeChatId="tail-a" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(screen.queryByText('tail A mensagem 6')).toBeNull()
    expect(screen.getByText('tail A mensagem 26')).toBeTruthy()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'end' })
  })


  it('prioritizes normative diffs and previews only a bounded changed-file list', () => {
    const files = [
      { path: 'services/frontend/src/a.ts', additions: 1, deletions: 0, diff: 'diff a' },
      { path: 'services/frontend/src/b.ts', additions: 1, deletions: 0, diff: 'diff b' },
      { path: 'services/frontend/src/c.ts', additions: 1, deletions: 0, diff: 'diff c' },
      { path: 'services/frontend/src/d.ts', additions: 1, deletions: 0, diff: 'diff d' },
      { path: 'services/frontend/src/e.ts', additions: 1, deletions: 0, diff: 'diff e' },
      { path: 'SoT/AI_PROTOCOL.md', additions: 2, deletions: 0, diff: 'diff normative' },
    ]
    const view = render(
      <ChatPanel session={session} items={[{ id: 'change-preview', role: 'harness', source: 'wharness', presentation: 'change', text: 'Aplicado.', change: { planId: 'plan-preview', files, appliedAt: '2026-09-09T18:00:00Z', canRevert: false } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(view.container.querySelectorAll('.change-file-row')).toHaveLength(4)
    expect(screen.getByText('SoT/AI_PROTOCOL.md')).toBeTruthy()
    expect(screen.getByText('Normativo')).toBeTruthy()
    expect(screen.queryByText('services/frontend/src/e.ts')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais 2 diffs' }))
    expect(view.container.querySelectorAll('.change-file-row')).toHaveLength(6)
    expect(screen.getByText('services/frontend/src/e.ts')).toBeTruthy()
  })

  it('renders actual host commands after the applied diff summary', () => {
    render(
      <ChatPanel session={session} items={[{ id: 'change-1', role: 'harness', source: 'wharness', presentation: 'change', text: 'Alterações e comandos aplicados ao host.', change: { planId: 'plan-1', files: [], hostCommands: [{ argv: ['make', 'build-stage'], cwd: '.', exit_code: 0, stdout: '', stderr: '', success: true, duration_ms: 4321 }], appliedAt: '2026-09-07T10:00:00Z', canRevert: false } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByText('Comandos no host')).toBeTruthy()
    expect(screen.getByText('make build-stage')).toBeTruthy()
    expect(screen.getByText('. · exit 0 · 4321 ms')).toBeTruthy()
  })


  it('exposes the project knowledge toggle and marks only the active state', async () => {
    const onKnowledgeSharing = vi.fn()
    const view = render(
      <ChatPanel session={{ ...session, knowledge_sharing_enabled: false }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onKnowledgeSharing={onKnowledgeSharing} {...chatActions} />,
    )
    let button = screen.getByRole('button', { name: 'Conhecimento do projeto' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.querySelector('svg')).toBeTruthy()
    expect(button.querySelector('.artifact-dot')).toBeNull()
    fireEvent.click(button)
    await waitFor(() => expect(onKnowledgeSharing).toHaveBeenCalledWith(true))

    view.rerender(
      <ChatPanel session={{ ...session, knowledge_sharing_enabled: true }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onKnowledgeSharing={onKnowledgeSharing} {...chatActions} />,
    )
    button = screen.getByRole('button', { name: 'Conhecimento do projeto' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.querySelector('.artifact-dot')).toBeTruthy()
  })


  it('renders the new-chat control as an icon-only plus button', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const button = screen.getByRole('button', { name: 'Novo chat' })
    expect(button.textContent).toBe('')
    expect(button.querySelector('svg')).toBeTruthy()
  })


  it('renders Harness responses as sanitized Markdown instead of raw markdown text', () => {
    render(
      <ChatPanel session={session} items={[{ id: 'md-1', role: 'harness', text: '## Prioridade\n\nA funcionalidade **Perfil Inteligente** é a primeira recomendação.' }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Prioridade' })).toBeTruthy()
    expect(screen.getByText('Perfil Inteligente').tagName).toBe('STRONG')
    expect(screen.queryByText('**Perfil Inteligente**')).toBeNull()
  })

  it('collapses long Markdown responses behind an explicit preview control', () => {
    const longBody = `## Resultado\n\n${'Detalhe operacional importante. '.repeat(70)}`
    render(
      <ChatPanel session={session} items={[{ id: 'md-long', role: 'harness', source: 'chatgpt', text: longBody }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const toggle = screen.getByRole('button', { name: 'Expandir conteúdo' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.chat-markdown-disclosure.collapsible:not(.expanded)')).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Mostrar menos' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.chat-markdown-disclosure.expanded')).toBeTruthy()
  })

  it('shows only the latest consecutive WHX notice until the ellipsis control is expanded', () => {
    const view = render(
      <ChatPanel session={session} items={[
        { id: 'whx-1', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Primeira atualização.' },
        { id: 'whx-2', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Segunda atualização.' },
        { id: 'whx-3', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Última atualização.' },
      ]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(view.container.querySelectorAll('.chat-notice')).toHaveLength(1)
    expect(screen.getAllByText('Última atualização.')).toHaveLength(2)
    const toggle = screen.getByRole('button', { name: 'Mostrar 2 notificações WHX anteriores' })
    fireEvent.click(toggle)
    expect(view.container.querySelectorAll('.chat-notice')).toHaveLength(3)
    expect(screen.getAllByText('Primeira atualização.')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Ocultar notificações WHX anteriores' })).toBeTruthy()
  })

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

  it('shows message date/time and copies any previous message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const createdAt = '2026-09-03T15:36:00.000Z'
    render(
      <ChatPanel session={session} items={[{ id: 'm1', role: 'user', text: 'mensagem anterior', createdAt }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(createdAt)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensagem' }))
    expect(writeText).toHaveBeenCalledWith('mensagem anterior')
  })

  it('selects files and submits them with the message', async () => {
    const onSend = vi.fn(async () => undefined)
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={onSend} {...chatActions} />,
    )
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['spec'], 'spec.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…'), { target: { value: 'implementar' } })
    fireEvent.submit(view.container.querySelector('form')!)
    expect(onSend).toHaveBeenCalledWith('implementar', [file], [], { context: false, prompt: true, result: false, error: false }, 'direct')
  })

  it('restores unsent file attachments after leaving and returning to the same chat', () => {
    const file = new File(['draft'], 'rascunho.txt', { type: 'text/plain' })
    const first = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="draft-files" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    fireEvent.change(first.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    expect(first.container.textContent).toContain('rascunho.txt')
    first.unmount()

    const restored = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="draft-files" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    expect(restored.container.textContent).toContain('rascunho.txt')
    restored.unmount()

    const other = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="other-chat" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    expect(other.container.textContent).not.toContain('rascunho.txt')
  })

  it('finds eligible project files from @file and turns the selection into a chip', () => {
    const referencedSession = {
      ...session,
      context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'src/App.tsx', size: 10, sha256: 'abc' }] } },
    }
    const view = render(
      <ChatPanel session={referencedSession} items={[]} chats={[]} activeChatId="file-ref-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…') as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Revê @file:App', selectionStart: 15 } })
    fireEvent.click(screen.getByRole('option', { name: /src\/App\.tsx/ }))
    expect(view.container.querySelector('.composer-file-reference-chip')?.textContent).toContain('src/App.tsx')
    expect(composer.value).toBe('Revê ')
    view.unmount()
  })

  it('adds files pasted from the operating-system clipboard', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    const file = new File(['image'], 'captura.png', { type: 'image/png' })
    const composer = view.container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.paste(composer, { clipboardData: { files: [file], items: [] } })
    expect(view.container.textContent).toContain('captura.png')
    expect((composer as HTMLTextAreaElement).value).toBe('')
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('requires explicit confirmation for a prepared ChatGPT draft', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} preparedAttachmentCount={2} onSend={async () => undefined} onConfirmPrepared={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByText('Preparação enviada ao ChatGPT')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirmar e enviar/ })).toBeTruthy()
  })

  it('offers a retry when ChatGPT could not receive a prepared prompt', async () => {
    const onRetryPreparedDelivery = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} failedPromptDelivery={{ kind: 'retry', requestId: 'req-retry' }} onSend={async () => undefined} onRetryPreparedDelivery={onRetryPreparedDelivery} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar entregar novamente' }))
    await waitFor(() => expect(onRetryPreparedDelivery).toHaveBeenCalledWith('req-retry'))
  })

  it('labels the retry as a post-attention retry when the ChatGPT composer needs human attention', async () => {
    const onRetryPreparedDelivery = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} failedPromptDelivery={{ kind: 'attention', requestId: 'req-attention' }} onSend={async () => undefined} onRetryPreparedDelivery={onRetryPreparedDelivery} {...chatActions} />,
    )
    expect(screen.getByText('Ação necessária no ChatGPT')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar depois de resolver' }))
    await waitFor(() => expect(onRetryPreparedDelivery).toHaveBeenCalledWith('req-attention'))
  })

  it('shows remote context generation progress while an enriched ZIP is being published', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="progress-test" busy={true} transportProgress="A gerar o ZIP enriquecido e a publicá-lo no provider…" onSend={async () => undefined} {...chatActions} />,
    )
    expect(screen.getByRole('status').textContent).toContain('A preparar rotas remotas')
    expect(screen.getByRole('status').textContent).toContain('provider')
  })

  it('keeps system artifact selectors inside the Wharness composer and marks automatic payloads', () => {
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} artifactSelection={{ context: true, prompt: true, result: false, error: false }} artifactRequired={{ context: true }} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…').closest('form')!
    expect(composer.querySelector('.composer-action-row')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Contexto ZIP' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Prompt' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('moves execution and automation choices into compact composer icons', () => {
    const onExecutionMode = vi.fn()
    const onAutomationMode = vi.fn()
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} executionMode="protected" automationMode="manual" onExecutionMode={onExecutionMode} onAutomationMode={onAutomationMode} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = screen.getByPlaceholderText('Pergunte, analise, diagnostique ou descreva uma alteração…').closest('form')!
    expect(composer.querySelector('[aria-label="Proteção de execução"]')).toBeTruthy()
    expect(composer.querySelector('[aria-label="Automação de execução"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Protected' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Unprotected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(onExecutionMode).toHaveBeenCalledWith('unprotected')
    expect(onAutomationMode).toHaveBeenCalledWith('auto')
  })

  it('keeps the request ZIP mandatory while each chat can enable or disable tunnel channels', () => {
    const onChatTransport = vi.fn()
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false}
        globalTransport={{ disabledTunnelIds: [] }} chatTransport={{ disabledTunnelIds: ['secondary'] }}
        tunnelInstances={[
          { id: 'primary', provider: 'cloudflare', available: true },
          { id: 'secondary', provider: 'tailscale', available: true },
          { id: 'offline', provider: 'cloudflare', available: false, error: 'offline' },
        ]}
        onChatTransport={onChatTransport} onSend={async () => undefined} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Túneis do ChatGPT' }))
    expect(screen.getByText('Sempre incluído em qualquer requisição')).toBeTruthy()
    const choices = screen.getAllByRole('menuitemcheckbox')
    expect(choices).toHaveLength(3)
    expect(choices[0].getAttribute('aria-checked')).toBe('true')
    expect(choices[1].getAttribute('aria-checked')).toBe('false')
    expect((choices[2] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(choices[1])
    expect(onChatTransport).toHaveBeenCalledWith({ disabledTunnelIds: [] })
    fireEvent.click(choices[0])
    expect(onChatTransport).toHaveBeenCalledWith({ disabledTunnelIds: ['secondary', 'primary'] })
    fireEvent.click(screen.getByRole('button', { name: /Usar padrão global/ }))
    expect(onChatTransport).toHaveBeenLastCalledWith(undefined)
  })

  it('can enable one tunnel from the migrated all-disabled selection', () => {
    const onChatTransport = vi.fn()
    render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false}
        globalTransport={{ disabledTunnelIds: ['*'] }}
        tunnelInstances={[
          { id: 'primary', provider: 'cloudflare', available: true },
          { id: 'secondary', provider: 'tailscale', available: true },
        ]}
        onChatTransport={onChatTransport} onSend={async () => undefined} {...chatActions} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Túneis do ChatGPT' }))
    const choices = screen.getAllByRole('menuitemcheckbox')
    expect(choices[0].getAttribute('aria-checked')).toBe('false')
    expect(choices[1].getAttribute('aria-checked')).toBe('false')
    fireEvent.click(choices[0])
    expect(onChatTransport).toHaveBeenCalledWith({ disabledTunnelIds: ['secondary'] })
  })

  it('keeps Unprotected disabled in the composer during self-evolution', () => {
    render(
      <ChatPanel session={{ ...session, self_evolution: true }} items={[]} chats={[]} activeChatId="chat-1" busy={false} executionMode="protected" automationMode="auto" onExecutionMode={vi.fn()} onAutomationMode={vi.fn()} onSend={async () => undefined} {...chatActions} />,
    )
    expect((screen.getByRole('button', { name: 'Unprotected' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps composer actions outside the scrolling text surface', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const scrollArea = composer.querySelector('.composer-scroll-area') as HTMLElement
    const footer = composer.querySelector('.composer-footer') as HTMLElement
    const send = screen.getByRole('button', { name: 'Enviar ao agente' })

    expect(scrollArea.contains(footer)).toBe(false)
    expect(footer.contains(send)).toBe(true)
  })

  it('resizes the composer from its top border instead of the native bottom-right handle', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-resize" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const handle = screen.getByRole('separator', { name: 'Redimensionar altura do chat composer' })
    vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, right: 600, bottom: 156, left: 0, width: 600, height: 156, toJSON: () => ({}) })

    const pointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY })
      Object.defineProperty(event, 'pointerId', { configurable: true, value: 7 })
      return event
    }

    fireEvent(handle, pointerEvent('pointerdown', 500))
    fireEvent(handle, pointerEvent('pointermove', 420))
    expect(composer.style.height).toBe('236px')

    fireEvent(handle, pointerEvent('pointermove', 900))
    expect(composer.style.height).toBe('118px')
    fireEvent(handle, pointerEvent('pointerup', 900))
  })

  it('grows the composer as multiline content expands, bounded by the configured maximum', async () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-growth" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const scrollArea = composer.querySelector('.composer-scroll-area') as HTMLElement
    const footer = composer.querySelector('.composer-footer') as HTMLElement
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 260 })
    Object.defineProperty(scrollArea, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(footer, 'offsetHeight', { configurable: true, value: 52 })
    Object.defineProperty(composer, 'offsetHeight', { configurable: true, value: 156 })
    Object.defineProperty(composer, 'clientHeight', { configurable: true, value: 154 })

    fireEvent.change(textarea, { target: { value: 'linha 1\nlinha 2\nlinha 3\nlinha 4' } })

    await waitFor(() => expect(composer.style.height).toBe('420px'))
  })

  it('reopens archived chats from the archive area', () => {
    const onRestoreChat = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} archivedChats={[{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T13:00:00.000Z', chatgptUrl: 'https://chatgpt.com/c/example' }]} activeChatId="" busy={false} onSend={async () => undefined} onNewChat={chatActions.onNewChat} onSelectChat={chatActions.onSelectChat} onArchiveChat={chatActions.onArchiveChat} onRestoreChat={onRestoreChat} onDeleteArchivedChat={chatActions.onDeleteArchivedChat} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Arquivados/ }))
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Reabrir/ }))
    expect(onRestoreChat).toHaveBeenCalledWith('arch-1')
  })
})


it('queues Enter and reserves Ctrl+Enter for an immediate comment while a task is active', async () => {
  const onRequestMode = vi.fn()
  const onComment = vi.fn(async () => undefined)
  const onSend = vi.fn(async () => undefined)
  const view = render(
    <ChatPanel session={{ ...session, pending_manual_request_ids: ['req-active'], last_manual_prompt: 'prompt' }} items={[]} chats={[]} activeChatId="chat-1" busy={false} requestMode="plan_first" taskInFlight onRequestMode={onRequestMode} onComment={onComment} onSend={onSend} {...chatActions} />,
  )
  const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement
  expect(screen.getByText(/Ctrl\+Enter comenta/)).toBeTruthy()

  fireEvent.change(textarea, { target: { value: 'fica para a próxima request principal' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })
  expect(onSend).toHaveBeenCalledWith('fica para a próxima request principal', [], [], { context: false, prompt: true, result: false, error: false }, 'plan_first')
  expect(textarea.value).toBe('')

  fireEvent.change(textarea, { target: { value: 'mantenha também o teste de regressão' } })
  fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
  expect(onComment).toHaveBeenCalledWith('mantenha também o teste de regressão', [])
  expect(textarea.value).toBe('')
})

it('renders and operates the waiting queue without placing it in the message stream', () => {
  const onQueueMove = vi.fn()
  const onQueueRemove = vi.fn()
  const onQueueMerge = vi.fn()
  render(<ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} queuedRequests={[
    { id: 'q1', message: 'primeira alteração', attachments: [], projectFiles: [], artifacts: { context: false, prompt: true, result: false, error: false }, requestMode: 'direct', createdAt: new Date().toISOString() },
    { id: 'q2', message: 'segunda alteração', attachments: [], projectFiles: [], artifacts: { context: false, prompt: true, result: false, error: false }, requestMode: 'direct', createdAt: new Date().toISOString() },
  ]} onQueueMove={onQueueMove} onQueueRemove={onQueueRemove} onQueueMerge={onQueueMerge} onSend={async () => undefined} {...chatActions} />)
  expect(screen.getByText('primeira alteração')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Descer request' })[0])
  expect(onQueueMove).toHaveBeenCalledWith('q1', 1)
  fireEvent.click(screen.getAllByRole('button', { name: 'Mesclar com a próxima' })[0])
  expect(onQueueMerge).toHaveBeenCalledWith('q1')
  fireEvent.click(screen.getAllByRole('button', { name: 'Remover request' })[0])
  expect(onQueueRemove).toHaveBeenCalledWith('q1')
})

it('moves the latest TODO snapshot to the composer task panel and makes iteration artifacts clickable', () => {
  const view = render(<ChatPanel session={session} items={[{
    id: 'result', role: 'harness', text: 'Implementação concluída.\n\n## TODO\n- [x] fila\n- [ ] validação final', iteration: { id: 'it', requestId: 'req-123', phase: 'result', artifacts: ['prompt'] },
  }]} chats={[]} activeChatId="chat-1" busy={false} artifactContent={{ prompt: '# Prompt\n\nconteúdo real' }} onSend={async () => undefined} {...chatActions} />)
  expect(screen.queryByRole('heading', { name: 'TODO' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tarefas TODO' }))
  expect(screen.getByText('validação final')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Ver prompt' }))
  expect(screen.getByText('conteúdo real')).toBeTruthy()
  expect(view.container.querySelector('.artifact-inspector')).toBeTruthy()
})

it('renders operational notices and visible ChatGPT activity differently from messages', () => {
  render(<ChatPanel session={session} items={[
    { id: 'notice', role: 'harness', source: 'wharness', presentation: 'notice', text: 'Correção automática preparada.' },
    { id: 'thought', role: 'harness', source: 'chatgpt', presentation: 'thought', text: 'A analisar os testes visíveis.' },
  ]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />)
  expect(document.querySelector('.chat-notice')).toBeTruthy()
  expect(document.querySelector('.chat-thought')).toBeTruthy()
})
