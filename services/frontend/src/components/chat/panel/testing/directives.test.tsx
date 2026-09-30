import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearEphemeralComposerDrafts } from '../../../../lib/chat/history/workspaceMemory'
import { api } from '../../../../lib/transport/http/api'
import { requestArtifactIndex } from '../../../../lib/artifacts/bundles/artifactIndexing'
import { panelRef, typeInComposer, composerText, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

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

it('defers whole-project browsing until @file or @see completion is active', async () => {
    const listFiles = vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [] })
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="file-lazy-explorer" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    await Promise.resolve()
    expect(listFiles).not.toHaveBeenCalled()
    typeInComposer(ref, 'Revê @file:', 'Revê @file:'.length)
    await waitFor(() => expect(listFiles).toHaveBeenCalledWith(session.id))
    view.unmount()
  })

it('offers @file targets from the whole safe project explorer, including directories outside the current context snapshot', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ files: [
      { path: 'src', name: 'src', kind: 'directory', size: 0 },
      { path: 'src/App.tsx', name: 'App.tsx', kind: 'file', size: 10 },
      { path: 'generated', name: 'generated', kind: 'directory', size: 0 },
      { path: 'generated/report.md', name: 'report.md', kind: 'file', size: 20 },
    ] })
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="file-whole-project" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    typeInComposer(ref, 'Revê @file:generated', 'Revê @file:generated'.length)
    await waitFor(() => expect(api.listFiles).toHaveBeenCalledWith(session.id))
    expect(await screen.findByText('generated/')).toBeTruthy()
    expect(screen.getByRole('option', { name: /generated\/report\.md/ })).toBeTruthy()
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

it('labels @chat files with their originating prompt when request lineage is available', async () => {
    vi.spyOn(api, 'chatFiles').mockResolvedValue({ files: [{
      artifact_id: 'artifact-origin', request_id: 'req-origin', direction: 'input', source: 'attachment',
      name: 'contrato.pdf', size: 42, created_at: '2026-09-20T04:00:00Z', direct: true,
    }] })
    const ref = panelRef()
    render(
      <ChatPanel ref={ref} session={session} items={[{
        id: 'prompt-origin', role: 'user', text: 'Analisa o contrato',
        iteration: { id: 'iteration-origin', requestId: 'req-origin', phase: 'outbound', artifacts: [] },
      }]} chats={[]} activeChatId="chat-file-origin" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    await waitFor(() => expect(api.chatFiles).toHaveBeenCalledWith(session.id))
    typeInComposer(ref, 'Revê @chat:', 'Revê @chat:'.length)

    expect(await screen.findByRole('option', { name: /Prompt 01 · contrato\.pdf/ })).toBeTruthy()
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
})
