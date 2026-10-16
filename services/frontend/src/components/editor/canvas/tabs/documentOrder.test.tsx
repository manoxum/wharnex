import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { reorderEditorDocuments } from './documentOrder'
import { EditorTabs } from '../EditorTabs'

const documents = ['first.ts', 'second.ts', 'third.ts'].map((path) => ({ path, content: 'original', draft: path === 'first.ts' ? 'unsaved change' : 'original', sha256: 'sha', size: 8 }))
describe('editor document ordering', () => {
  it('moves a document without changing drafts, identities or the input array', () => {
    const next = reorderEditorDocuments(documents, 'first.ts', 'third.ts', 'after')
    expect(next.map((document) => document.path)).toEqual(['second.ts', 'third.ts', 'first.ts'])
    expect(next[2]).toBe(documents[0])
    expect(next[2].draft).toBe('unsaved change')
    expect(documents.map((document) => document.path)).toEqual(['first.ts', 'second.ts', 'third.ts'])
    expect(reorderEditorDocuments(documents, 'unknown.ts', 'first.ts')).toBe(documents)
    expect(reorderEditorDocuments(documents, 'first.ts', 'unknown.ts')).toBe(documents)
    expect(reorderEditorDocuments(documents, 'first.ts', 'first.ts')).toBe(documents)
  })
  it('supports the keyboard reorder gesture without closing, saving or selecting a different document', () => {
    const reorder = vi.fn(), close = vi.fn(), save = vi.fn(async () => true), select = vi.fn()
    render(<EditorTabs documents={documents} activePath="second.ts" gitByPath={new Map()} savingPaths={new Set()} onClose={close} onSave={save} onSelect={select} onReorder={reorder}/>)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'second.ts' }), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    expect(reorder).toHaveBeenCalledWith('second.ts', 'first.ts', 'before')
    expect(close).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })
})
