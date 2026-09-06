import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
import { AgentWorkspace } from './AgentWorkspace'

function session(): Session {
  return {
    id: 'ses-agent', project_path: '/workspace/wharness', state: 'planned', execution_mode: 'protected', automation_mode: 'auto', created_at: new Date().toISOString(),
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abcdef123456', files: [], excluded: [], text_truncated: false } },
    plan: { protocol: 'harness.execution/v1', plan_id: 'plan-agent', request_id: 'req-agent', status: 'ready', summary: 'Atualizar UI', risk: 'low', requires_approval: false, operations: [], verification: [] },
    policy: { allowed: true, requires_approval: false, risk: 'low', reasons: [] },
  }
}

function props(current = session(), human: { notice?: DesktopChatGPTHumanAction; nonce?: number; onAction?: () => void } = {}, busy = false) {
  const onExecute = vi.fn(async () => undefined)
  const onRestore = vi.fn(async () => undefined)
  const onDelete = vi.fn(async () => undefined)
  const onOpenFile = vi.fn()
  return {
    onExecute, onRestore, onDelete, onOpenFile,
    element: <AgentWorkspace
      session={current}
      busy={busy}
      chatgptHumanAction={human.notice}
      chatgptAttentionNonce={human.nonce}
      onChatGPTHumanAction={human.onAction}
      onOpenFile={onOpenFile}
      onError={vi.fn()}
      chatProps={{
        session: current, items: [], chats: [{ id: 'chat-1', title: 'Principal', sessionId: current.id, createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' }, { id: 'chat-2', title: 'Paralelo', sessionId: 'ses-parallel', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z' }],
        archivedChats: [{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' }], activeChatId: 'chat-1', busy,
        onSend: async () => undefined, onNewChat: async () => undefined, onSelectChat: async () => undefined, onArchiveChat: async () => undefined, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
      }}
      inspectorProps={{
        config: { planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }, session: current, events: [], manualPrompt: '', busy,
        onChatGPTURL: () => true, onExecute, onApply: async () => undefined, onRejectPendingChanges: async () => undefined, onManualPlan: async () => undefined, onPlanFile: async () => '', onBundleFile: async () => '', onSession: () => undefined,
      }}
    />,
  }
}

describe('AgentWorkspace', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the chat fixed on the left and uses the right-side tabs for the inspector', () => {
    const view = props()
    const rendered = render(view.element)
    expect(screen.getByRole('navigation', { name: 'Áreas do Agent' })).toBeTruthy()
    expect(screen.queryByText('Agent Inspector')).toBeNull()
    expect(screen.queryByText('Harness chat')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull()
    const chatSwitcher = screen.getByRole('navigation', { name: 'Conversas do Harness' })
    const newChat = screen.getByRole('button', { name: 'Novo chat' })
    expect(newChat.textContent).toBe('')
    expect(newChat.querySelector('svg')).toBeTruthy()
    expect(chatSwitcher.className).toContain('agent-chat-switcher')
    expect(chatSwitcher.closest('.agent-commandbar')).toBeNull()
    expect(rendered.container.querySelector('.agent-chat-stage .chat-panel')).toBeTruthy()
    expect(rendered.container.querySelector('.agent-inspector-stage .inspector-panel')).toBeTruthy()
    const execute = screen.getByRole('button', { name: 'Executar plano na sandbox' })
    expect(execute.textContent).toBe('')
    fireEvent.click(execute)
    expect(view.onExecute).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Plano' }))
    expect(screen.getByText('Atualizar UI')).toBeTruthy()
  })

  it('keeps human ChatGPT intervention visible and opens the ChatGPT inspector on acknowledgement', async () => {
    const current = session()
    const onHumanAction = vi.fn()
    const notice: DesktopChatGPTHumanAction = { cacheKey: 'chat-1', active: true, kind: 'verification', source: 'dom', message: 'Conclua a verificação humana.', detectedAt: '2026-09-05T13:00:00.000Z' }
    const view = props(current, { notice, nonce: 0, onAction: onHumanAction })
    const { rerender } = render(view.element)
    const action = screen.getByRole('button', { name: 'Ação humana necessária no ChatGPT' })
    expect(action.getAttribute('title')).toBe('Conclua a verificação humana.')
    fireEvent.click(action)
    expect(onHumanAction).toHaveBeenCalledTimes(1)
    rerender(props(current, { notice, nonce: 1, onAction: onHumanAction }).element)
    await waitFor(() => expect(screen.getByRole('button', { name: 'ChatGPT' }).className).toContain('active'))
  })

  it('opens archived chats from the left activity drawer', () => {
    const view = props()
    render(view.element)
    fireEvent.click(screen.getByRole('button', { name: 'Chats arquivados' }))
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir Diagnóstico antigo' }))
    expect(view.onRestore).toHaveBeenCalledWith('arch-1')
  })

  it('opens a JetBrains-style project tree from the second activity icon', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [
      { path: 'README.md', name: 'README.md', kind: 'file', size: 100 },
      { path: 'services', name: 'services', kind: 'directory', size: 0 },
      { path: 'services/frontend', name: 'frontend', kind: 'directory', size: 0 },
    ] })
    const view = props()
    render(view.element)
    fireEvent.click(screen.getByRole('button', { name: 'Explorador do projeto' }))
    const readme = await screen.findByRole('button', { name: 'Abrir README.md no Editor' })
    fireEvent.click(readme)
    expect(view.onOpenFile).toHaveBeenCalledWith('README.md')
  })
  it('keeps chat navigation available while the active chat is processing', () => {
    const view = props(session(), {}, true)
    render(view.element)
    expect((screen.getByRole('button', { name: 'Novo chat' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: /^Paralelo$/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the WHX evolution badge and evidence action only for backend-qualified self-evolution', async () => {
    const normal = props()
    const rendered = render(normal.element)
    expect(screen.queryByText('WHX · AUTO-EVOLUÇÃO')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Logs de auto-evolução' })).toBeNull()

    const self = { ...session(), self_evolution: true }
    vi.spyOn(api, 'evolutionEvidence').mockResolvedValue({ events: [], counts: {}, projects: [], categories: [], total: 0, truncated: false })
    rendered.rerender(props(self).element)
    expect(screen.getByText('WHX · AUTO-EVOLUÇÃO')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Logs de auto-evolução' }))
    await waitFor(() => expect(screen.getByText(/0 evento\(s\) não tratado\(s\)/)).toBeTruthy())
  })

  it('opens project-wide plan and execution drawers with full details', async () => {
    const current = session()
    current.last_execution = { plan_id: 'plan-agent', success: true, started_at: '2026-09-05T10:00:00.000Z', completed_at: '2026-09-05T10:00:01.000Z', commands: [{ argv: ['npm', 'test'], cwd: 'services/frontend', exit_code: 0, stdout: 'tests ok', stderr: '', duration_ms: 900, success: true }] }
    const getSession = vi.spyOn(api, 'getSession').mockResolvedValue({ ...current, id: 'ses-parallel', plan: { ...current.plan!, plan_id: 'plan-parallel', summary: 'Plano paralelo' } })
    render(props(current).element)
    fireEvent.click(screen.getByRole('button', { name: 'Planos do projeto' }))
    await waitFor(() => expect(screen.getAllByText('Plano paralelo').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Execuções do projeto' }))
    await waitFor(() => expect(screen.getByText('npm test')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/tests ok/)).toBeTruthy())
    expect(getSession).toHaveBeenCalledTimes(2)
  })

})
