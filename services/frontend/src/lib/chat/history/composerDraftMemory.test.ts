import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearComposerDraft, loadComposerDraft, loadComposerFileDraft, loadComposerStoredFileDraft,
  saveComposerDraft, saveComposerFileDraft, saveComposerStoredFileDraft, scheduleComposerDraftSave,
} from './composerDraftMemory'

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('composer draft memory', () => {
  it('keeps drafts bounded and migrates the previous default height', () => {
    saveComposerDraft('/p', 'chat-a', { message: 'Olá mundo', height: 999 })
    expect(loadComposerDraft('/p', 'chat-a')).toEqual({ message: 'Olá mundo', height: 420 })
    localStorage.setItem('kernl.workspace.composer-draft.v1:/p:chat-a', JSON.stringify({ message: 'rascunho antigo', height: 180 }))
    expect(loadComposerDraft('/p', 'chat-a')).toEqual({ message: 'rascunho antigo', height: 156 })
    localStorage.setItem('kernl.workspace.composer-draft.v1:/p:chat-b', JSON.stringify({ message: 'altura curta', height: 118 }))
    expect(loadComposerDraft('/p', 'chat-b')).toEqual({ message: 'altura curta', height: 156 })
    clearComposerDraft('/p', 'chat-a')
    expect(loadComposerDraft('/p', 'chat-a')).toEqual({ message: '', height: 156 })
  })

  it('coalesces rapid writes while keeping the latest chat draft readable', () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    scheduleComposerDraftSave('/p', 'chat-a', { message: 'primeiro', height: 220 })
    scheduleComposerDraftSave('/p', 'chat-a', { message: 'segundo', height: 230 })
    expect(loadComposerDraft('/p', 'chat-a')).toEqual({ message: 'segundo', height: 230 })
    vi.advanceTimersByTime(180)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('kernl.workspace.composer-draft.v1:/p:chat-a') || '{}')).toEqual({ message: 'segundo', height: 230 })
  })

  it('keeps unsent files scoped to a chat and persists attachment references', () => {
    const file = new File(['draft'], 'draft.txt', { type: 'text/plain' })
    saveComposerFileDraft('/p', 'chat-a', { attachments: [file], projectFiles: ['src/App.tsx'] })
    expect(loadComposerFileDraft('/p', 'chat-a')).toEqual({ attachments: [file], projectFiles: ['src/App.tsx'] })
    expect(loadComposerFileDraft('/p', 'chat-b')).toEqual({ attachments: [], projectFiles: [] })
    const attachments = [{ name: 'draft.txt', size: 5, mime: 'text/plain', storageRef: 'chat-a/composer_draft/0', previewKind: 'icon' as const, lastModified: 1_700_000_000_000 }]
    saveComposerStoredFileDraft('/p', 'chat-a', attachments)
    expect(loadComposerStoredFileDraft('/p', 'chat-a')).toEqual(attachments)
    expect(loadComposerStoredFileDraft('/p', 'chat-b')).toEqual([])
    clearComposerDraft('/p', 'chat-a')
    expect(loadComposerFileDraft('/p', 'chat-a')).toEqual({ attachments: [], projectFiles: [] })
  })
})
