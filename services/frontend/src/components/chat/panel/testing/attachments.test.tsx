import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../ChatPanel'
import { clearComposerDraft, clearEphemeralComposerDrafts, loadComposerStoredFileDraft, saveComposerStoredFileDraft } from '../../../../lib/chat/history/workspaceMemory'
import { panelRef, typeInComposer, session, chatActions } from './panelTestFixtures'

describe('ChatPanel', () => {
  afterEach(() => { clearEphemeralComposerDrafts(); delete window.wharnessDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); if (document.querySelector('.app-dialog-backdrop')) fireEvent.keyDown(document, { key: 'Escape' }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })

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

it('keeps a readable composer floor across chat restores and focuses from its empty surface', () => {
    localStorage.setItem('kernl.workspace.composer-draft.v1:/tmp/demo:short-composer', JSON.stringify({ message: '', height: 118 }))
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="short-composer" busy={false} onSend={async () => undefined} {...chatActions} />,
    )

    const composer = view.container.querySelector('form.composer') as HTMLFormElement
    const editorShell = view.container.querySelector('.composer-editor-shell') as HTMLDivElement
    const editor = ref.current?.getComposerEditor()
    if (!editor) throw new Error('composer editor not mounted')
    const focus = vi.spyOn(editor, 'focus')
    expect(composer.style.height).toBe('180px')
    fireEvent.pointerDown(editorShell, { button: 0, pointerId: 1 })
    expect(focus).toHaveBeenCalledTimes(1)
    clearComposerDraft(session.project_path, 'short-composer')
  })

it('reinforces active-project attention directly on the composer while typing', () => {
    const onComposerTyping = vi.fn()
    const ref = panelRef()
    const view = render(
      <ChatPanel ref={ref} session={session} items={[]} chats={[]} activeChatId="typing" busy={false} onSend={async () => undefined} onComposerTyping={onComposerTyping} {...chatActions} />,
    )

    const composer = view.container.querySelector('form.composer')
    expect(composer?.classList.contains('composer-typing-attention')).toBe(false)
    typeInComposer(ref, 'confirmar projeto atual', 'confirmar projeto atual'.length)
    expect(onComposerTyping).toHaveBeenCalledTimes(1)
    expect(composer?.classList.contains('composer-typing-attention')).toBe(true)
    expect(screen.getByRole('status', { name: 'Projeto ativo: demo' }).textContent).toContain('demo')
    expect(screen.getByTitle('/tmp/demo').textContent).toBe('demo')
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
})
