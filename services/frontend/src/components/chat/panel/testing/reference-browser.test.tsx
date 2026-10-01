import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { api } from '../../../../lib/transport/http/api'
import { panelRef, typeInComposer, readFileText, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

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

it('materializes the complete @todo analysis and stored artifacts on submit', async () => {
    const ref = panelRef()
    const onSend = vi.fn().mockResolvedValue(undefined)
    const todo = {
      id: 'todo_1', project_path: session.project_path, body: 'Melhorar a pesquisa', status: 'open' as const,
      classification_status: 'classified' as const, kind: 'improvement' as const, urgency: 'urgent' as const,
      description: 'Preservar o fluxo atual.', pre_plan: ['Medir o fluxo.', 'Cobrir com testes.'],
      project_files: ['src/search.ts'],
      attachments: [{ name: 'evidence.txt', size: 8, mime: 'text/plain', storage_ref: 'todo/evidence.txt' }],
      created_at: '2026-09-20T04:00:00Z', updated_at: '2026-09-20T04:01:00Z',
    }
    vi.spyOn(api, 'projectTodos').mockResolvedValue({ todos: [todo] })
    const read = vi.fn().mockResolvedValue({ name: 'evidence.txt', mime: 'text/plain', contentBase64: btoa('evidence') })
    Object.defineProperty(window, 'wharnessDesktop', { configurable: true, value: { attachments: { read } } })
    render(<ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="todo-submit" busy={false} attachmentsEnabled onSend={onSend} {...chatActions} />)

    await waitFor(() => expect(api.projectTodos).toHaveBeenCalledWith(session.id))
    const prompt = 'Executa @{[todo]todo_1}'
    typeInComposer(ref, prompt, prompt.length)
    const editor = ref.current?.getComposerEditor()
    if (!editor) throw new Error('composer editor not mounted')
    fireEvent.keyDown(editor.root, { key: 'Enter' })

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    const [message, files] = onSend.mock.calls[0]
    expect(message).toBe(prompt)
    expect(files.map((file: File) => file.name)).toEqual(expect.arrayContaining([
      'wharnex-todo-todo_1-pre-analysis.md',
      'evidence.txt',
    ]))
    expect(read).toHaveBeenCalledWith({ storageRef: 'todo/evidence.txt' })
    const analysis = files.find((file: File) => file.name === 'wharnex-todo-todo_1-pre-analysis.md')
    if (!analysis) throw new Error('TODO pre-analysis attachment not found')
    const markdown = await readFileText(analysis)
    expect(markdown).toContain('Preservar o fluxo atual.')
    expect(markdown).toContain('1. Medir o fluxo.')
    expect(markdown).toContain('src/search.ts')
  })

it('projects completed directives to distinct thumbnails without promoting incomplete queries', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="summary-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const references = 'usa @{[file]src/App.tsx} @{[ref]flowcore} @{[attach]/srv/contracts} @{[see]upload|mock.png} @{[chat]artifact|artifact-1} @{[lib]session|ses-a|artifact-b} @{[todo]todo_1} @{[task]otk_done}'
    typeInComposer(ref, references, references.length)
    for (const kind of ['file', 'ref', 'attach', 'chat', 'lib', 'todo', 'task']) expect(view.container.querySelector(`.composer-reference-thumbnail.${kind}`)).toBeTruthy()
    expect(view.container.querySelector('.composer-reference-thumbnail.see')).toBeNull()
    expect(view.container.querySelector('.composer-directive-chip.file')).toBeTruthy()

    const repeated = 'usa @{[file]src/App.tsx} e depois @{[file]src/App.tsx}'
    typeInComposer(ref, repeated, repeated.length)
    expect(view.container.querySelectorAll('.composer-reference-thumbnail.file')).toHaveLength(1)

    typeInComposer(ref, 'Revê @file:App', 14)
    expect(view.container.querySelector('.composer-reference-thumbnail.file')).toBeNull()
    view.unmount()
  })

it('opens a dedicated project-file viewer from a reference thumbnail', () => {
    const referencedSession = {
      ...session,
      context: { ...session.context, manifest: { ...session.context.manifest, files: [{ path: 'src/App.tsx', size: 10, sha256: 'abc' }] } },
    }
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={referencedSession} items={[]} chats={[]} activeChatId="thumbnail-viewer-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Revê @{[file]src/App.tsx} agora', 30)
    fireEvent.click(screen.getByRole('button', { name: 'Visualizar referência @file App.tsx' }))
    expect(document.querySelector('.composer-reference-viewer.file')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Visualizar referência @file App.tsx' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar visualização da referência' }))
    expect(document.querySelector('.composer-reference-viewer.file')).toBeNull()
    view.unmount()
  })

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
})
