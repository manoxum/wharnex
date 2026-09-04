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

function props(current = session()) {
  const onExecute = vi.fn(async () => undefined)
  const onRestore = vi.fn(async () => undefined)
  const onDelete = vi.fn(async () => undefined)
  const onOpenFile = vi.fn()
  return {
    onExecute, onRestore, onDelete, onOpenFile,
    element: <AgentWorkspace
      session={current}
      busy={false}
      onOpenFile={onOpenFile}
      onError={vi.fn()}
      chatProps={{
        session: current, items: [], chats: [{ id: 'chat-1', title: 'Principal', sessionId: current.id, createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' }],
        archivedChats: [{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' }], activeChatId: 'chat-1', busy: false,
        onSend: async () => undefined, onNewChat: async () => undefined, onSelectChat: async () => undefined, onArchiveChat: async () => undefined, onRestoreChat: onRestore, onDeleteArchivedChat: onDelete,
      }}
      inspectorProps={{
        config: { planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }, session: current, events: [], manualPrompt: '', busy: false,
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar ficheiros' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Abrir README.md no Editor' }))
    expect(view.onOpenFile).toHaveBeenCalledWith('README.md')
  })
})
