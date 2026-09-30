import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { api } from '../../../../lib/transport/http/api'
import { panelRef, typeInComposer, composerText, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('prepares, but does not submit, a selected structured interview answer', () => {
    const ref = panelRef()
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<ChatPanel ref={ref} session={session} items={[{
      id: 'interview', role: 'harness', source: 'chatgpt', text: 'Preciso desta decisão.', createdAt: new Date().toISOString(), turnKind: 'clarification',
      interview: { protocol: 'harness.interview/v1', questions: [{ id: 'retention', prompt: 'Qual retenção?', options: [{ id: 'three', label: '3 dias' }, { id: 'thirty', label: '30 dias' }] }] },
    }]} chats={[]} activeChatId="chat-1" busy={false} onSend={onSend} {...chatActions} />)
    fireEvent.click(screen.getByRole('button', { name: '3 dias' }))
    expect(composerText(ref)).toContain('3 dias')
    expect(onSend).not.toHaveBeenCalled()
  })

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

it('previews the next composer bundle without clearing or sending the draft', async () => {
    const ref = panelRef()
    const preview = {
      id: 'artifact-preview', request_id: 'req_preview', direction: 'input' as const, kind: 'bundle-preview',
      name: 'whx_bundle_req_chat-1_req_preview.zip', content_type: 'application/zip', size: 2048,
      sha256: 'a'.repeat(64), created_at: '2026-09-15T16:20:00Z', expires_at: '2026-10-15T16:20:00Z', bundle: true, entry_count: 1,
    }
    const onPreviewBundle = vi.fn().mockResolvedValue(preview)
    const onSend = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(api, 'artifactEntries').mockResolvedValue({ entries: [{ path: 'prompt/wharness-planner-prompt.md', size: 128, dir: false }] })
    const deletePreview = vi.spyOn(api, 'deleteManagedArtifact').mockResolvedValue({ deleted: true })
    render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} onSend={onSend} onPreviewBundle={onPreviewBundle} {...chatActions} />,
    )

    typeInComposer(ref, 'implemente a mudança', 'implemente a mudança'.length)
    fireEvent.click(screen.getByRole('button', { name: 'Pré-visualizar próximo bundle' }))

    await waitFor(() => expect(onPreviewBundle).toHaveBeenCalledTimes(1))
    expect(onSend).not.toHaveBeenCalled()
    expect(composerText(ref)).toBe('implemente a mudança')
    expect((await screen.findAllByText('Pré-visualização · próximo bundle')).length).toBeGreaterThan(0)
    fireEvent.click(await screen.findByText('prompt')); expect(await screen.findByText('wharness-planner-prompt.md')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar explorador' }))
    await waitFor(() => expect(deletePreview).toHaveBeenCalledWith(session.id, preview.id))
  })

it('prepares an execution-plan adjustment as a composer attachment and submits it through the adjustment continuation', async () => {
    const ref = panelRef()
    const onSend = vi.fn().mockResolvedValue(undefined)
    const onAdjustExecutionPlan = vi.fn().mockResolvedValue(undefined)
    render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="chat-adjust" busy={false} onSend={onSend} onAdjustExecutionPlan={onAdjustExecutionPlan} {...chatActions} />,
    )

    act(() => ref.current?.prepareExecutionPlanAdjustment({
      protocol: 'harness.execution/v2', plan_id: 'plan-adjust', request_id: 'req-parent', status: 'ready', summary: 'Implementar o fluxo original',
      document: '## Implementação\nAlterar o painel.', impact_files: ['services/frontend/src/App.tsx'], risk: 'medium', requires_approval: true,
      operations: [], verification: [],
    }))

    expect(screen.getByText('Ajustar plano de execução')).toBeTruthy()
    expect(screen.getByText('plano-execucao-plan-adjust.md', { selector: 'b' })).toBeTruthy()
    const seePrompt = 'Revê @see:'
    typeInComposer(ref, seePrompt, seePrompt.length)
    fireEvent.click(screen.getByRole('option', { name: /Anexos diretos/ }))
    expect(screen.getByRole('option', { name: /plano-execucao-plan-adjust\.md/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /plano-execucao-plan-adjust\.md/ }))
    expect(composerText(ref)).toContain('@{[see]upload|plano-execucao-plan-adjust.md}')
    const guidance = 'Mantém o backend e altera apenas a experiência visual.'
    typeInComposer(ref, guidance, guidance.length)
    const editor = ref.current?.getComposerEditor()
    if (!editor) throw new Error('composer editor not mounted')
    fireEvent.keyDown(editor.root, { key: 'Enter' })

    await waitFor(() => expect(onAdjustExecutionPlan).toHaveBeenCalledTimes(1))
    expect(onSend).not.toHaveBeenCalled()
    const [message, files, projectFiles, artifacts] = onAdjustExecutionPlan.mock.calls[0]
    expect(message).toBe(guidance)
    expect(files.map((file: File) => file.name)).toContain('plano-execucao-plan-adjust.md')
    expect(projectFiles).toEqual([])
    expect(artifacts).toEqual({ context: false, prompt: true, result: false, error: false })
  })

it('keeps hash and chat identity copyable without rendering either value in the compact context header', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = render(
      <ChatPanel session={{ ...session, state: 'applied', context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'README.md', size: 12, sha256: 'abc' }] } } }} items={[]} chats={[]} activeChatId="chat-1" busy={false} onSend={async () => undefined} onExportChat={async () => undefined} {...chatActions} />,
    )
    const context = view.container.querySelector('.chat-header-context')
    expect(context?.textContent).toContain('Contexto isolado')
    expect(context?.textContent).toContain('Aplicado')
    expect(context?.textContent).not.toContain('abcdef123456')
    expect(context?.textContent).not.toContain('chat-1')
    expect(screen.getByRole('button', { name: 'Exportar ZIP' }).closest('.chat-header-context')).toBe(context)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar hash e ID do chat' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Hash: abcdef1234567890\nChat ID: chat-1'))
    expect(view.container.querySelector('.chat-stream .system-note')).toBeNull()
  })

it('identifies a namespaced multi-project context in the header', () => {
    const related = { project_path: '/work/related', name: 'related', prefix: 'RELATED_PROJECTS/01-related/', manifest: session.context.manifest }
    const view = render(
      <ChatPanel session={{ ...session, context: { ...session.context, workspace_sha256: 'fedcba654321', related_projects: [related] } }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(view.container.querySelector('.chat-header-context')?.textContent).toContain('Contexto de 2 projetos')
    expect(view.container.querySelector('.chat-header-context')?.textContent).not.toContain('fedcba654321')
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
})
