import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { api } from '../../../../lib/transport/http/api'
import { panelRef, typeInComposer, composerText, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

it('renders an @see chip and configures it like the other directive kinds', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="see-test" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'compara @{[see]diagram.png} com o mockup', 41)
    expect(view.container.querySelector('.composer-directive-chip.see')?.getAttribute('title')).toBe('@{[see]diagram.png}')
    fireEvent.click(screen.getByLabelText('Configurar referência'))
    const popover = view.container.querySelector('.composer-directive-popover')
    expect(popover?.textContent).toContain('Destacar referência')
    expect(popover?.textContent).toContain('Referência não encontrada')
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
    const prompt = 'usa @{[file]src} e destaca @see:'
    typeInComposer(ref, prompt, prompt.length)
    expect(screen.getByRole('option', { name: /Projeto atual/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /src\/App\.tsx/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Projeto atual/ }))
    const directoryOption = screen.getByText('src/').closest('button')
    expect(directoryOption).toBeTruthy()
    expect(screen.getByRole('option', { name: /src\/App\.tsx/ })).toBeTruthy()
    fireEvent.click(directoryOption!)
    expect(composerText(ref)).toBe('usa @{[file]src} e destaca @{[see]file|src}')
    view.unmount()
  })

it('browses files and folders from an indexed @ref that is not attached yet', async () => {
    vi.spyOn(api, 'knownProjects').mockResolvedValue({ projects: [{ name: 'flowcore', project_path: '/work/flowcore', open: false }] })
    const inspection = {
      root: '/work/flowcore', kind: 'directory', auto_exclude: true, include: [], include_overrides: [], exclude: [],
      included_files: 2, included_bytes: 20, excluded_items: 0, truncated: false, max_file_bytes: 1024, max_total_bytes: 4096, max_files: 100,
      entries: [
        { path: 'services/api/auth.go', kind: 'file', status: 'included' as const, size: 10 },
        { path: 'services/web/App.tsx', kind: 'file', status: 'included' as const, size: 10 },
      ],
    }
    const inspect = vi.spyOn(api, 'referenceInspection').mockResolvedValue(inspection)
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="see-unattached-ref" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const prompt = 'usa @{[ref]flowcore} e destaca @see:'
    typeInComposer(ref, prompt, prompt.length)

    await waitFor(() => expect(inspect).toHaveBeenCalledWith(session.id, '@{[ref]flowcore}'))
    const source = await screen.findByRole('option', { name: /@ref flowcore/ })
    fireEvent.click(source)

    await waitFor(() => expect(screen.getByText('services/').closest('button')).toBeTruthy())
    expect(screen.getByText('services/api/').closest('button')).toBeTruthy()
    expect(screen.getByText('services/api/auth.go').closest('button')).toBeTruthy()
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
    const prompt = 'usa @{[file]src} e @{[ref]flowcore/api} e destaca @see:'
    typeInComposer(ref, prompt, prompt.length)
    const editor = ref.current?.getComposerEditor()
    fireEvent.keyDown(editor!.root, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /@ref flowcore/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(editor!.root, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /Projeto atual/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(editor!.root, { key: 'Enter' })
    expect(composerText(ref)).toBe('usa @{[file]src} e @{[ref]flowcore/api} e destaca @see:file|')
    view.unmount()
  })

it('explains an empty @ref menu when Wharnex knows no other project', () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="ref-empty" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    typeInComposer(ref, 'Compara com @ref:', 17)
    expect(screen.getByRole('listbox', { name: 'Referenciar outro projeto' }).textContent).toContain('Nenhum outro projeto conhecido por este Wharnex')
    view.unmount()
  })

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

it('enables Portuguese spell checking on the actual Quill editing root', async () => {
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="spellcheck" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    await waitFor(() => {
      const editor = ref.current?.getComposerEditor()
      expect(editor?.root.getAttribute('spellcheck')).toBe('true')
      expect(editor?.root.getAttribute('lang')).toBe('pt-PT')
    })
    view.unmount()
  })

it('opens native spelling suggestions with Ctrl+Space on the current word', async () => {
    const showSuggestions = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'wharnessDesktop', { configurable: true, value: { spellcheck: { showSuggestions } } })
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="spellcheck-shortcut" busy={false} onSend={async () => undefined} {...chatActions} />,
    )
    const editor = ref.current?.getComposerEditor()
    if (!editor) throw new Error('composer editor not mounted')
    typeInComposer(ref, 'palavar', 7)
    vi.spyOn(editor, 'getBounds').mockReturnValue({ left: 12, top: 8, right: 60, bottom: 28, width: 48, height: 20 } as never)
    const editorContainer = (editor as unknown as { container: HTMLElement }).container
    vi.spyOn(editorContainer, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 200, right: 500, bottom: 260, width: 400, height: 60, x: 100, y: 200, toJSON: () => ({}) } as DOMRect)

    fireEvent.keyDown(view.container.querySelector('.composer-rich-editor')!, { key: ' ', code: 'Space', ctrlKey: true })

    await waitFor(() => expect(showSuggestions).toHaveBeenCalledWith({ x: 136, y: 218 }))
    view.unmount()
  })
})
