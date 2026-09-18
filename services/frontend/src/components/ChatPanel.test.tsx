import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef, type RefObject } from 'react'
import QuillDelta from 'quill-delta'
import { ChatPanel, type ChatPanelHandle } from './ChatPanel'
import type { Session } from '../types'
import { clearComposerDraft, clearEphemeralComposerDrafts, loadComposerStoredFileDraft, saveComposerStoredFileDraft } from '../lib/workspaceMemory'
import { api } from '../lib/api'
import { deltaToCanonicalText, directivesToDelta, textOffsetToQuillIndex } from '../lib/composerRichText'
import { requestArtifactIndex } from '../lib/artifactIndexing'

// jsdom cannot faithfully simulate real keystrokes into a contenteditable
// Quill instance (no real Selection/Range layout), so these tests drive the
// composer directly through the same Quill API ChatPanel's own directive
// handlers use internally (see ChatPanel.editDirective / selectDirective),
// via the escape hatch ChatPanelHandle exposes for exactly this reason.
function panelRef() { return createRef<ChatPanelHandle>() }

function typeInComposer(ref: RefObject<ChatPanelHandle | null>, text: string, caret: number) {
  const editor = ref.current?.getComposerEditor()
  if (!editor) throw new Error('composer editor not mounted')
  act(() => {
    editor.setContents(new QuillDelta(directivesToDelta(text).ops) as never, 'user')
    editor.setSelection(textOffsetToQuillIndex(text, caret), 0, 'user')
  })
}

function composerText(ref: RefObject<ChatPanelHandle | null>) {
  const editor = ref.current?.getComposerEditor()
  return editor ? deltaToCanonicalText(editor.getContents() as never) : ''
}

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
  // Dialogs mount straight onto document.body, so React's cleanup never removes
  // them, and a test that ends with one still open — a blocked submission keeps
  // it open by design — leaves it for the next test to match. Cancelling rather
  // than dropping the node also settles its promise, which is what releases the
  // serialized dialog queue so the following test's dialog can still open.
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

  it('keeps a bounded transcript DOM while following a long chat scrollbar', async () => {
    const items = Array.from({ length: 120 }, (_, index) => ({ id: `long-${index + 1}`, role: 'user' as const, text: `longa mensagem ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="long-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 21600 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 360 })

    stream.scrollTop = 0
    fireEvent.scroll(stream)
    await waitFor(() => expect(screen.getByText('longa mensagem 1')).toBeTruthy())

    stream.scrollTop = 30 * 180
    fireEvent.scroll(stream)
    await waitFor(() => expect(screen.getByText('longa mensagem 31')).toBeTruthy())

    expect(view.container.querySelectorAll('.chat-stream article.message').length).toBeLessThanOrEqual(60)
    expect(screen.queryByText('longa mensagem 120')).toBeNull()
    expect(screen.getByRole('button', { name: 'Carregar mensagens mais recentes' })).toBeTruthy()
  })

  it('keeps the transcript content aligned with a drag to the beginning of a long scroll', async () => {
    const items = Array.from({ length: 120 }, (_, index) => ({ id: `scroll-alignment-${index + 1}`, role: 'user' as const, text: `scroll alinhado ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="scroll-alignment" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 21600 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 360 })
    stream.scrollTop = 0
    fireEvent.scroll(stream)

    await waitFor(() => expect(screen.getByText('scroll alinhado 1')).toBeTruthy())
    expect(view.container.querySelectorAll('.chat-stream article.message').length).toBeLessThanOrEqual(60)
  })

  it('defers rich offscreen transcript entries until they approach the scroll viewport', async () => {
    const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = []
    class TestIntersectionObserver {
      readonly targets: Element[] = []
      constructor(readonly callback: IntersectionObserverCallback) { observers.push(this) }
      observe(target: Element) { this.targets.push(target) }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `deferred-rich-${index + 1}`, role: 'harness' as const, source: 'chatgpt' as const,
      text: `## Markdown pesado ${index + 1}\n\n${'conteúdo renderizado '.repeat(300)}`,
    }))
    render(<ChatPanel session={session} items={items} chats={[]} activeChatId="deferred-rich" busy={false} onSend={async () => undefined} {...chatActions} />)

    expect(screen.queryByText(/Markdown pesado 1/)).toBeNull()
    expect(screen.getByText(/Markdown pesado 8/)).toBeTruthy()
    expect(observers).toHaveLength(4)

    observers[0].callback([{ isIntersecting: true, target: observers[0].targets[0] } as IntersectionObserverEntry], {} as IntersectionObserver)
    await waitFor(() => expect(screen.getByText(/Markdown pesado 1/)).toBeTruthy())
  })


  it('hydrates admitted older transcript content one scheduled item at a time behind skeletons', async () => {
    const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = []
    class TestIntersectionObserver {
      readonly targets: Element[] = []
      constructor(readonly callback: IntersectionObserverCallback) { observers.push(this) }
      observe(target: Element) { this.targets.push(target) }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]
    }
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const items = Array.from({ length: 8 }, (_, index) => ({ id: `staged-${index + 1}`, role: 'user' as const, text: `conteúdo faseado ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="staged-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(screen.getByText('conteúdo faseado 8')).toBeTruthy()
    expect(screen.getByText('conteúdo faseado 5')).toBeTruthy()
    expect(screen.queryByText('conteúdo faseado 1')).toBeNull()
    expect(view.container.querySelectorAll('.chat-entry-skeleton')).toHaveLength(4)
    expect(observers).toHaveLength(4)
    expect(frames).toHaveLength(0)

    await act(async () => {
      observers[0].callback([{ isIntersecting: true, target: observers[0].targets[0] } as IntersectionObserverEntry], {} as IntersectionObserver)
      observers[1].callback([{ isIntersecting: true, target: observers[1].targets[0] } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(frames).toHaveLength(1)

    await act(async () => { frames.shift()?.(performance.now()) })
    expect(screen.getByText('conteúdo faseado 2')).toBeTruthy()
    expect(screen.queryByText('conteúdo faseado 1')).toBeNull()
    expect(view.container.querySelectorAll('.chat-entry-skeleton')).toHaveLength(3)

    await act(async () => { frames.shift()?.(performance.now()) })
    expect(screen.getByText('conteúdo faseado 1')).toBeTruthy()
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

    await waitFor(() => expect(screen.getByText('chat A mensagem 1')).toBeTruthy())

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

  it('separates the total deletion count for danger styling', () => {
    const view = render(
      <ChatPanel session={session} items={[{ id: 'change-total-stats', role: 'harness', source: 'wharness', presentation: 'change', text: 'Aplicado.', change: { planId: 'plan-total-stats', files: [{ path: 'services/frontend/src/a.ts', additions: 7, deletions: 3, diff: 'diff total stats' }], appliedAt: '2026-09-09T18:00:00Z', canRevert: false } }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    expect(view.container.querySelector('.change-summary-card > header > code')?.textContent).toBe('+7 −3')
    expect(view.container.querySelector('.change-summary-card > header > code i')?.textContent).toBe('−3')
  })

  it('offers the inverse restore action for a reverted change card', async () => {
    const onRevertChange = vi.fn(async () => undefined)
    const item = { id: 'change-reverted', role: 'harness' as const, source: 'wharness' as const, presentation: 'change' as const, text: 'Revertido.', change: { planId: 'plan-reverted', files: [], appliedAt: '2026-09-09T18:00:00Z', canRevert: true, reverted: true } }
    render(
      <ChatPanel session={session} items={[item]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onRevertChange={onRevertChange} {...chatActions} />,
    )

    const button = screen.getByRole('button', { name: 'Repor alteração' })
    fireEvent.click(button)
    await waitFor(() => expect(onRevertChange).toHaveBeenCalledWith(item))
    expect(screen.queryByRole('button', { name: 'Reverter alteração' })).toBeNull()
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

  it('bounds long Markdown DOM until the operator expands the full response', () => {
    const longBody = `## Resultado\n\n${'Detalhe operacional importante. '.repeat(70)}\n\nFULL_MARKDOWN_TAIL`
    render(
      <ChatPanel session={session} items={[{ id: 'md-long', role: 'harness', source: 'chatgpt', text: longBody }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const toggle = screen.getByRole('button', { name: 'Expandir conteúdo' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.chat-markdown-disclosure.collapsible:not(.expanded)')).toBeTruthy()
    expect(screen.queryByText('FULL_MARKDOWN_TAIL')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Mostrar menos' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.chat-markdown-disclosure.expanded')).toBeTruthy()
    expect(screen.getByText('FULL_MARKDOWN_TAIL')).toBeTruthy()
  })

  it('truncates very large user prompts until the operator expands them', () => {
    const longPrompt = `Primeira linha do prompt\n${'contexto muito grande '.repeat(90)}\nFULL_PROMPT_TAIL`
    render(
      <ChatPanel session={session} items={[{ id: 'user-prompt-long', role: 'user', text: longPrompt }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const toggle = screen.getByRole('button', { name: 'Expandir prompt' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.chat-prompt-disclosure.collapsible:not(.expanded)')).toBeTruthy()
    expect(screen.queryByText(/FULL_PROMPT_TAIL/)).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Mostrar menos' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/FULL_PROMPT_TAIL/)).toBeTruthy()
  })

  it('coalesces rapid transcript scroll window updates to one animation frame', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const items = Array.from({ length: 120 }, (_, index) => ({ id: `scroll-frame-${index + 1}`, role: 'user' as const, text: `mensagem frame ${index + 1}` }))
    const view = render(
      <ChatPanel session={session} items={items} chats={[]} activeChatId="scroll-frame-chat" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const stream = view.container.querySelector('.chat-stream') as HTMLDivElement
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 21600 })
    Object.defineProperty(stream, 'clientHeight', { configurable: true, value: 360 })

    stream.scrollTop = 10 * 180
    fireEvent.scroll(stream)
    stream.scrollTop = 20 * 180
    fireEvent.scroll(stream)
    stream.scrollTop = 30 * 180
    fireEvent.scroll(stream)

    expect(frames).toHaveLength(1)
    await act(async () => { frames.shift()?.(performance.now()) })
    await waitFor(() => expect(screen.getByText('mensagem frame 31')).toBeTruthy())
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
    expect(screen.getAllByText('Última atualização.')).toHaveLength(1)
    const toggle = screen.getByRole('button', { name: 'Mostrar 2 notificações WHX anteriores' })
    fireEvent.click(toggle)
    expect(view.container.querySelectorAll('.chat-notice')).toHaveLength(3)
    expect(screen.getAllByText('Primeira atualização.')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Ocultar notificações WHX anteriores' })).toBeTruthy()
  })

  it('defers rich notice Markdown until the native disclosure is opened', () => {
    const noticeText = `${'Atualização extensa para diagnóstico. '.repeat(60)}\n\n**FULL_NOTICE_TAIL**`
    const view = render(
      <ChatPanel session={session} items={[{ id: 'notice-heavy', role: 'harness', source: 'wharness', presentation: 'notice', text: noticeText }]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    expect(view.container.querySelector('.chat-markdown-disclosure')).toBeNull()
    const summary = view.container.querySelector<HTMLElement>('.chat-notice > summary')
    expect(summary).toBeTruthy()
    fireEvent.click(summary!)
    expect(view.container.querySelector('.chat-markdown-disclosure')).toBeTruthy()
    expect(screen.queryByText('FULL_NOTICE_TAIL')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir conteúdo' }))
    expect(screen.getByText('FULL_NOTICE_TAIL')).toBeTruthy()
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

  // The notice a non-retryable planner failure actually produces carries the
  // "Pedido não concluído" meta, which also matches the transport-failure
  // recovery. Offering its bare resume here sends a retry with no guidance,
  // which the planner's own retryable=false forces the backend to refuse every
  // time, so the operator only ever gets the refusal back.
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
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={onSend} {...chatActions} />,
    )
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['spec'], 'spec.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    typeInComposer(ref, 'implementar', 'implementar'.length)
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

  it('restores persisted draft attachments after a full renderer reload', async () => {
    const chatId = 'durable-draft-files'
    const stored = { name: 'persistido.txt', size: 5, mime: 'text/plain', storageRef: `${chatId}/composer_draft/0`, previewKind: 'icon' as const }
    const lastModified = 1_700_000_000_000
    const persist = vi.fn().mockResolvedValue({ ok: true, attachments: [stored] })
    const read = vi.fn().mockResolvedValue({ name: stored.name, mime: stored.mime, contentBase64: btoa('draft') })
    Object.defineProperty(window, 'wharnessDesktop', { configurable: true, value: { attachments: { persist, read } } })

    const first = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId={chatId} busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    const file = new File(['draft'], stored.name, { type: stored.mime, lastModified })
    fireEvent.change(first.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    await waitFor(() => expect(loadComposerStoredFileDraft(session.project_path, chatId)).toEqual([{ ...stored, lastModified }]))
    first.unmount()
    clearEphemeralComposerDrafts()

    const restored = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId={chatId} busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    await waitFor(() => expect(restored.container.textContent).toContain(stored.name))
    expect(read).toHaveBeenCalledWith({ storageRef: stored.storageRef })
    clearComposerDraft(session.project_path, chatId)
  })

  it('drops a persisted draft attachment when its stored bytes cannot be recovered', async () => {
    const chatId = 'missing-draft-file'
    const stored = { name: 'perdido.txt', size: 7, mime: 'text/plain', storageRef: `${chatId}/composer_draft/0`, previewKind: 'none' as const, lastModified: 1_700_000_000_000 }
    saveComposerStoredFileDraft(session.project_path, chatId, [stored])
    Object.defineProperty(window, 'wharnessDesktop', { configurable: true, value: { attachments: { persist: vi.fn(), read: vi.fn().mockRejectedValue(new Error('missing')) } } })

    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId={chatId} busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    await waitFor(() => expect(loadComposerStoredFileDraft(session.project_path, chatId)).toEqual([]))
    expect(view.container.textContent).not.toContain(stored.name)
    expect(view.container.textContent).toContain('já não estavam disponíveis')
  })

  it('persists a selected file before a keyed chat switch can unmount the composer', () => {
    const file = new File(['draft'], 'troca-imediata.txt', { type: 'text/plain' })
    const panel = (chatId: string) => (
      <ChatPanel key={chatId} session={session} items={[]} chats={[]} activeChatId={chatId} busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />
    )
    const view = render(panel('chat-a'))
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })

    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      view.rerender(panel('chat-b'))
    })
    expect(view.container.textContent).not.toContain('troca-imediata.txt')

    view.rerender(panel('chat-a'))
    expect(view.container.textContent).toContain('troca-imediata.txt')
  })

  // A reference stays in the sentence that needed it. Moving it to a list at the
  // end throws away the only thing its placement was carrying — which file the
  // sentence is about.
  it('completes @file inline and leaves the marker where it was typed', () => {
    const referencedSession = {
      ...session,
      context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'src/App.tsx', size: 10, sha256: 'abc' }] } },
    }
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={referencedSession} items={[]} chats={[]} activeChatId="file-ref-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Revê @file:App e depois pára', 14)
    fireEvent.click(screen.getByRole('option', { name: /src\/App\.tsx/ }))
    expect(composerText(ref)).toBe('Revê @{[file]src/App.tsx} e depois pára')
    // The chip is a real embedded node, not the marker's own tinted text — its
    // title still carries the exact canonical marker it stands for.
    expect(view.container.querySelector('.composer-directive-chip.file')?.getAttribute('title')).toBe('@{[file]src/App.tsx}')
    view.unmount()
  })

  it('inserts @chat references at the current composer caret as a chip', async () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="chat-file-insert" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    typeInComposer(ref, 'Revê isto agora', 5)
    act(() => requestArtifactIndex('chat', 'artifact|artifact-1'))

    await waitFor(() => expect(composerText(ref)).toBe('Revê @{[chat]artifact|artifact-1} isto agora'))
    expect(view.container.querySelector('.composer-directive-chip.chat')?.getAttribute('title')).toBe('@{[chat]artifact|artifact-1}')
    view.unmount()
  })

  it('does not replay the chip insertion caret after every following keystroke', async () => {
    const referencedSession = {
      ...session,
      context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'src/App.tsx', size: 10, sha256: 'abc' }] } },
    }
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={referencedSession} items={[]} chats={[]} activeChatId="stable-chip-caret" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Revê @file:App', 14)
    fireEvent.click(screen.getByRole('option', { name: /src\/App\.tsx/ }))

    const editor = ref.current?.getComposerEditor()
    if (!editor) throw new Error('composer editor not mounted')
    const insertionIndex = editor.getSelection()?.index
    expect(insertionIndex).toBeTypeOf('number')

    act(() => {
      editor.insertText(insertionIndex!, ' agora', 'user')
      editor.setSelection(insertionIndex! + ' agora'.length, 0, 'user')
    })

    await waitFor(() => expect(editor.getSelection()?.index).toBe(insertionIndex! + ' agora'.length))
    expect(composerText(ref)).toBe('Revê @{[file]src/App.tsx} agora')
    view.unmount()
  })

  // `@ref` names another bound project, and picking one keeps the menu open so a
  // file inside it can follow: the two are one intent at two levels of detail.
  it('completes @ref from the bound projects and then their files', () => {
    const referencedSession = {
      ...session,
      context: {
        ...session.context,
        related_projects: [{
          project_path: '/home/op/flowcore', name: 'flowcore', prefix: 'RELATED_PROJECTS/01-flowcore/',
          manifest: { ...session.context.manifest, files: [{ path: 'services/be/auth.go', size: 10, sha256: 'abc' }] },
        }],
      },
    }
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={referencedSession} items={[]} chats={[]} activeChatId="ref-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Alinha com @ref:flow', 20)
    fireEvent.click(screen.getByRole('option', { name: /flowcore/ }))
    expect(composerText(ref)).toBe('Alinha com @ref:flowcore/')

    typeInComposer(ref, 'Alinha com @ref:flowcore/auth', 29)
    fireEvent.click(screen.getByRole('option', { name: /services\/be\/auth\.go/ }))
    expect(composerText(ref)).toBe('Alinha com @{[ref]flowcore/services/be/auth.go}')
    expect(view.container.querySelector('.composer-directive-chip.ref')).toBeTruthy()
    view.unmount()
  })

  // There is nothing to autocomplete for a path outside every project, so the
  // menu offers the picker instead of guesses.
  it('offers a picker for @attach instead of completions', () => {
    const ref = panelRef()
    render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="attach-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'junta @attach:', 14)
    expect(screen.getByRole('option', { name: /Escolher pasta/ })).toBeTruthy()
  })

  it('renders directive autocomplete outside the scrollable composer content', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="directive-layer" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    typeInComposer(ref, '@', 1)

    const menu = screen.getByRole('listbox', { name: 'Escolher tipo de referência' })
    expect(view.container.querySelector('.composer-scroll-area')?.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
    view.unmount()
  })

  // An attachment written by hand is still configurable: the toolbar control
  // opens the same selection panel the picker does.
  it('exposes the attachment selection panel once a path is attached', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="attach-panel" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'junta @{[attach]/srv/contracts} agora', 36)
    expect(view.container.querySelector('.composer-directive-chip.attach')?.getAttribute('title')).toBe('@{[attach]/srv/contracts}')
    fireEvent.click(screen.getByLabelText('Conteúdo dos caminhos anexados'))
    expect(view.container.querySelector('.composer-attachment-panel')).toBeTruthy()
    view.unmount()
  })

  // The canonical marker is represented only where it occurs in the prompt;
  // there is no second summary row competing with the editing surface.
  it('renders a completed directive only as the rich chip in the text', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="summary-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Revê @{[file]src/App.tsx} agora', 30)
    const chip = view.container.querySelector('.composer-directive-chip.file')
    expect(chip).toBeTruthy()
    expect(chip?.textContent).not.toContain('@{[file]')
    expect(view.container.querySelector('.composer-directive-summary')).toBeNull()
    view.unmount()
  })

  // The dedicated settings icon opens the full selection modal directly.
  it('opens the context selection modal from an attach chip settings action', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="popover-summary-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'junta @{[attach]/srv/contracts} agora', 36)
    const settings = screen.getByLabelText('Configurar referência')
    expect(settings.textContent).not.toContain('Aa')
    expect(settings.querySelector('svg')).toBeTruthy()
    fireEvent.click(settings)
    expect(view.container.querySelector('.composer-attachment-panel')).toBeTruthy()
    expect(view.container.querySelector('.composer-directive-popover')).toBeNull()
    view.unmount()
  })

  it('opens the context selection modal directly from a ref chip settings action', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="ref-settings-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'consulta @{[ref]flowcore} agora', 30)

    fireEvent.click(screen.getByLabelText('Configurar referência'))

    expect(view.container.querySelector('.composer-attachment-panel')).toBeTruthy()
    expect(view.container.querySelector('.composer-directive-popover')).toBeNull()
    view.unmount()
  })

  it('opens the configuration popover when a chip in the text itself is clicked', () => {
    const referencedSession = {
      ...session,
      context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'src/App.tsx', size: 10, sha256: 'abc' }] } },
    }
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={referencedSession} items={[]} chats={[]} activeChatId="popover-inline-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Revê @{[file]src/App.tsx} agora', 30)
    fireEvent.click(view.container.querySelector('.composer-directive-chip.file')!)
    const popover = view.container.querySelector('.composer-directive-popover')
    expect(popover).toBeTruthy()
    expect(popover?.textContent).toContain('Ficheiro do projeto')
    view.unmount()
  })

  // @see/@look points at a file already attached directly to this message —
  // it renders and configures exactly like the other three kinds.
  it('renders an @see chip and configures it like the other directive kinds', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="see-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'compara @{[see]diagram.png} com o mockup', 41)
    expect(view.container.querySelector('.composer-directive-chip.see')?.getAttribute('title')).toBe('@{[see]diagram.png}')
    fireEvent.click(screen.getByLabelText('Configurar referência'))
    const popover = view.container.querySelector('.composer-directive-popover')
    expect(popover?.textContent).toContain('Ficheiro ou diretório visível')
    expect(popover?.textContent).toContain('Não encontrado no contexto atual')
    view.unmount()
  })

  it('selects an @see source before showing files and directories inside that source', () => {
    const sourceSession = {
      ...session,
      context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'src/App.tsx', size: 10, sha256: 'abc' }] } },
    }
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={sourceSession} items={[]} chats={[]} activeChatId="see-source-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'destaca @see:', 14)
    expect(screen.getByRole('option', { name: /Projeto atual/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /src\/App\.tsx/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Projeto atual/ }))
    const directoryOption = screen.getByText('src/').closest('button')
    expect(directoryOption).toBeTruthy()
    expect(screen.getByRole('option', { name: /src\/App\.tsx/ })).toBeTruthy()
    fireEvent.click(directoryOption!)
    expect(composerText(ref)).toBe('destaca @{[see]project|src}')
    view.unmount()
  })

  it('moves the directive suggestion selection with ArrowUp and ArrowDown', () => {
    const sourceSession = {
      ...session,
      context: {
        ...session.context,
        manifest: { ...session.context.manifest, files: [{ path: 'src/App.tsx', size: 10, sha256: 'abc' }] },
        related_projects: [{ project_path: '/work/flowcore', name: 'flowcore', prefix: 'RELATED_PROJECTS/01-flowcore/', manifest: { ...session.context.manifest, files: [{ path: 'api/auth.go', size: 10, sha256: 'def' }] } }],
      },
    }
    const ref = panelRef()
    const view = render(<ChatPanel ref={ref} session={sourceSession} items={[]} chats={[]} activeChatId="directive-arrows" busy={false} onSend={async () => undefined} {...chatActions} />)
    typeInComposer(ref, 'destaca @see:', 14)
    const editor = ref.current?.getComposerEditor()
    fireEvent.keyDown(editor!.root, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Projeto atual/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(editor!.root, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /@ref flowcore/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(editor!.root, { key: 'ArrowDown' })
    fireEvent.keyDown(editor!.root, { key: 'Enter' })
    expect(composerText(ref)).toBe('destaca @see:project|')
    view.unmount()
  })

  // Nothing bound is not a failed search: the operator has made no mistake, and
  // saying so points at the action that fixes it.
  it('explains an empty @ref menu when Wharnex knows no other project', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="ref-empty" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Compara com @ref:', 17)
    expect(screen.getByRole('listbox', { name: 'Referenciar outro projeto' }).textContent).toContain('Nenhum outro projeto conhecido por este Wharnex')
    view.unmount()
  })

  // A project Wharnex has worked on before is nameable from @ref whether or
  // not it is currently attached to this session — the composer's known-
  // projects menu has to consult the same candidate set the engine actually
  // resolves a reference against, not only the session's already-attached
  // related projects.
  it('offers a project Wharnex has worked on before, even when it is not attached', async () => {
    const spy = vi.spyOn(api, 'knownProjects').mockResolvedValue({ projects: [{ name: 'flowcore', project_path: '/home/op/flowcore', open: true }] })
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="ref-known" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalledWith(session.id))
    await waitFor(() => {
      typeInComposer(ref, 'Compara com @ref:flow', 21)
      expect(screen.getByRole('option', { name: /flowcore/ })).toBeTruthy()
    })
    view.unmount()
  })

  it('adds files pasted from the operating-system clipboard', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="" busy={false} attachmentsEnabled onSend={async () => undefined} {...chatActions} />,
    )
    const file = new File(['image'], 'captura.png', { type: 'image/png' })
    const composer = view.container.querySelector('.composer-rich-editor')!
    fireEvent.paste(composer, { clipboardData: { files: [file], items: [] } })
    expect(view.container.textContent).toContain('captura.png')
    expect(composerText(ref)).toBe('')
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

  it('keeps system artifact selectors inside the Wharnex composer and marks automatic payloads', () => {
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} artifactSelection={{ context: true, prompt: true, result: false, error: false }} artifactRequired={{ context: true }} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('form')!
    expect(composer.querySelector('.composer-action-row')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Contexto ZIP' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Prompt' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('moves execution and automation choices into compact composer icons', () => {
    const onExecutionMode = vi.fn()
    const onAutomationMode = vi.fn()
    const view = render(
      <ChatPanel session={session} items={[]} chats={[]} activeChatId="chat-1" busy={false} executionMode="protected" automationMode="manual" onExecutionMode={onExecutionMode} onAutomationMode={onAutomationMode} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('form')!
    expect(composer.querySelector('[aria-label="Proteção de execução"]')).toBeTruthy()
    expect(composer.querySelector('[aria-label="Automação de execução"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Protected' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Unprotected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(onExecutionMode).toHaveBeenCalledWith('unprotected')
    expect(onAutomationMode).toHaveBeenCalledWith('auto')
  })

  it('keeps provider reasoning separate from the autonomous attempt budget', () => {
    const onReasoningEffort = vi.fn()
    render(
      <ChatPanel session={{ ...session, effort_level: 'ultra', reasoning_effort: 'medium' }} items={[]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onReasoningEffort={onReasoningEffort} {...chatActions} />,
    )
    const picker = screen.getByLabelText('Esforço de raciocínio') as HTMLSelectElement
    expect(picker.value).toBe('medium')
    fireEvent.change(picker, { target: { value: 'instant' } })
    expect(onReasoningEffort).toHaveBeenCalledWith('instant')
    expect((screen.getByLabelText('Nível de esforço') as HTMLSelectElement).value).toBe('ultra')
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
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="chat-growth" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const composer = view.container.querySelector('.composer') as HTMLFormElement
    const scrollArea = composer.querySelector('.composer-scroll-area') as HTMLElement
    const footer = composer.querySelector('.composer-footer') as HTMLElement
    Object.defineProperty(scrollArea, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(footer, 'offsetHeight', { configurable: true, value: 52 })
    Object.defineProperty(composer, 'offsetHeight', { configurable: true, value: 156 })
    Object.defineProperty(composer, 'clientHeight', { configurable: true, value: 154 })

    typeInComposer(ref, 'linha 1\nlinha 2\nlinha 3\nlinha 4', 'linha 1\nlinha 2\nlinha 3\nlinha 4'.length)

    await waitFor(() => expect(composer.style.height).toBe('420px'))
  })

  it('reopens the latest closed chat directly from the chat switcher', () => {
    const onRestoreChat = vi.fn(async () => undefined)
    const archivedChats = [
      { id: 'arch-latest', title: 'Último fechado', sessionId: 'ses-latest', createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T15:00:00.000Z' },
      { id: 'arch-older', title: 'Mais antigo', sessionId: 'ses-older', createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T11:00:00.000Z' },
    ]
    render(
      <ChatPanel session={session} items={[]} chats={[]} archivedChats={archivedChats} activeChatId="" busy={false} onSend={async () => undefined} onNewChat={chatActions.onNewChat} onSelectChat={chatActions.onSelectChat} onArchiveChat={chatActions.onArchiveChat} onRestoreChat={onRestoreChat} onDeleteArchivedChat={chatActions.onDeleteArchivedChat} />,
    )

    const reopen = screen.getByRole('button', { name: 'Reabrir último chat fechado' })
    expect(reopen.getAttribute('title')).toContain('Último fechado')
    fireEvent.click(reopen)
    expect(onRestoreChat).toHaveBeenCalledWith('arch-latest')
  })

  it('reopens archived chats from the archive area', () => {
    const onRestoreChat = vi.fn(async () => undefined)
    render(
      <ChatPanel session={session} items={[]} chats={[]} archivedChats={[{ id: 'arch-1', title: 'Diagnóstico antigo', sessionId: 'ses-old', createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T13:00:00.000Z', chatgptUrl: 'https://chatgpt.com/c/example' }]} activeChatId="" busy={false} onSend={async () => undefined} onNewChat={chatActions.onNewChat} onSelectChat={chatActions.onSelectChat} onArchiveChat={chatActions.onArchiveChat} onRestoreChat={onRestoreChat} onDeleteArchivedChat={chatActions.onDeleteArchivedChat} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Arquivados/ }))
    expect(screen.getByText('Diagnóstico antigo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
    expect(onRestoreChat).toHaveBeenCalledWith('arch-1')
  })
})


it('queues Enter and reserves Ctrl+Enter for an immediate comment while a task is active', async () => {
  const onRequestMode = vi.fn()
  const onComment = vi.fn(async () => undefined)
  const onSend = vi.fn(async () => undefined)
  const ref = panelRef()
  const view = render(
    <ChatPanel ref={ref} session={{ ...session, pending_manual_request_ids: ['req-active'], last_manual_prompt: 'prompt' }} items={[]} chats={[]} activeChatId="chat-1" busy={false} requestMode="plan_first" taskInFlight onRequestMode={onRequestMode} onComment={onComment} onSend={onSend} {...chatActions} />,
  )
  const editor = view.container.querySelector('.composer-rich-editor')!
  expect(screen.getByText(/Ctrl\+Enter comenta/)).toBeTruthy()

  typeInComposer(ref, 'fica para a próxima request principal', 'fica para a próxima request principal'.length)
  fireEvent.keyDown(editor, { key: 'Enter' })
  expect(onSend).toHaveBeenCalledWith('fica para a próxima request principal', [], [], { context: false, prompt: true, result: false, error: false }, 'plan_first')
  expect(composerText(ref)).toBe('')

  typeInComposer(ref, 'mantenha também o teste de regressão', 'mantenha também o teste de regressão'.length)
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
  expect(onComment).toHaveBeenCalledWith('mantenha também o teste de regressão', [])
  expect(composerText(ref)).toBe('')
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


it('requests correction guidance before replacing a pending plan proposal', async () => {
  const onCorrectPlan = vi.fn(async () => undefined)
  const item = { id: 'plan-pending', role: 'harness' as const, source: 'chatgpt' as const, presentation: 'plan' as const, text: '## TODO\n- [ ] Alterar fluxo', approval: { status: 'pending' as const, requestId: 'req-plan' } }
  render(
    <ChatPanel session={session} items={[item]} chats={[]} activeChatId="" busy={false} onSend={async () => undefined} onCorrectPlan={onCorrectPlan} {...chatActions} />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Solicitar correção' }))
  const input = document.querySelector<HTMLInputElement>('.app-dialog-field input')!
  fireEvent.change(input, { target: { value: 'Adicionar rollback explícito' } })
  fireEvent.click(document.querySelector<HTMLButtonElement>('.app-dialog-button.primary')!)

  await waitFor(() => expect(onCorrectPlan).toHaveBeenCalledWith(item, 'Adicionar rollback explícito'))
})
