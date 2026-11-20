import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { saveChangesDialog } from '../../../../lib/desktop/bridge/appDialog'
import { disposeEditorModel } from '../../../../lib/editor/runtime/monaco'
import { documentCloseTargets, useDocumentActions, type EditorDocument } from './useDocumentActions'
vi.mock('../../../../lib/desktop/bridge/appDialog', () => ({ saveChangesDialog: vi.fn() }))
vi.mock('../../../../lib/editor/runtime/monaco', () => ({ disposeEditorModel: vi.fn() }))
const file = (path: string, dirty = false): EditorDocument => ({ path, content: '', draft: dirty ? 'edit' : '', sha256: '', size: 0 })
beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })
function setup(initial = [file('a'), file('b', true), file('c', true)]) {
  const reopen = vi.fn().mockResolvedValue(undefined)
  const save = vi.fn().mockResolvedValue(true)
  const view = renderHook(() => {
    const [documents, setDocuments] = useState(initial)
    const documentsRef = useRef(documents); documentsRef.current = documents
    const [activePath, setActivePath] = useState<string | undefined>('b')
    const [, setPreviewPaths] = useState(new Set<string>())
    const actions = useDocumentActions({ projectPath: '/work', documentsRef, setDocuments, activePath, setActivePath, setPreviewPaths, hiddenPaths: new Set(['other-group']), save: async (path) => { const result = await save(path); if (result) { documentsRef.current = documentsRef.current.map((item) => item.path === path ? { ...item, content: item.draft } : item); setDocuments(documentsRef.current) } return result }, reopen })
    return { documents, activePath, actions, setDocuments }
  })
  return { ...view, save, reopen }
}
it('computes clicked-tab close scopes without crossing groups or batch-closing pins', () => {
  const documents = ['a', 'b', 'c', 'other-group'].map((path) => file(path))
  const pins = new Set(['c']), hidden = new Set(['other-group'])
  expect(documentCloseTargets(documents, 'b', 'others', pins, hidden).map((item) => item.path)).toEqual(['a'])
  expect(documentCloseTargets(documents, 'a', 'right', pins, hidden).map((item) => item.path)).toEqual(['b'])
  expect(documentCloseTargets(documents, 'c', 'current', pins, hidden).map((item) => item.path)).toEqual(['c'])
})
it('cancels a batch atomically and serializes confirmation attempts', async () => {
  let resolve!: (choice: 'cancel') => void
  vi.mocked(saveChangesDialog).mockImplementation(() => new Promise((done) => { resolve = done }))
  const view = setup()
  let pending!: Promise<void>
  act(() => { pending = view.result.current.actions.close('b', 'all') })
  await act(async () => view.result.current.actions.close('b', 'all'))
  expect(saveChangesDialog).toHaveBeenCalledTimes(1)
  await act(async () => { resolve('cancel'); await pending })
  expect(view.result.current.documents).toHaveLength(3)
  expect(disposeEditorModel).not.toHaveBeenCalled()
})
it('saves all dirty candidates before closing, protects pins and reopens history', async () => {
  vi.mocked(saveChangesDialog).mockResolvedValue('save')
  const view = setup()
  act(() => view.result.current.actions.togglePin('a'))
  await act(async () => view.result.current.actions.close('b', 'all'))
  expect(view.save.mock.calls.map(([path]) => path)).toEqual(['b', 'c'])
  expect(view.result.current.documents.map((item) => item.path)).toEqual(['a'])
  expect(saveChangesDialog).toHaveBeenCalledTimes(1)
  expect(view.result.current.actions.pinned.has('a')).toBe(true)
  expect(JSON.parse(localStorage.getItem('wharnex.editor.pins.v1:/work')!)).toEqual(['a'])
  await act(async () => view.result.current.actions.reopen())
  expect(view.reopen).toHaveBeenCalledWith('c')
})
it('keeps the entire batch open on save failure', async () => {
  vi.mocked(saveChangesDialog).mockResolvedValue('save')
  const view = setup(); view.save.mockResolvedValue(false)
  await act(async () => view.result.current.actions.close('b', 'all'))
  expect(view.result.current.documents).toHaveLength(3)
  expect(disposeEditorModel).not.toHaveBeenCalled()
})
it('discards only after explicit consent without writing drafts', async () => {
  vi.mocked(saveChangesDialog).mockResolvedValue('discard')
  const view = setup()
  await act(async () => view.result.current.actions.close('b', 'all'))
  expect(view.result.current.documents).toHaveLength(0)
  expect(view.save).not.toHaveBeenCalled()
  expect(view.result.current.activePath).toBeUndefined()
})
it('retains a draft edited while its confirmation was pending', async () => {
  let resolve!: (choice: 'discard') => void
  vi.mocked(saveChangesDialog).mockImplementation(() => new Promise((done) => { resolve = done }))
  const view = setup()
  let pending!: Promise<void>
  act(() => { pending = view.result.current.actions.close('b', 'all') })
  act(() => view.result.current.setDocuments((items) => items.map((item) => item.path === 'b' ? { ...item, draft: 'later' } : item)))
  await act(async () => { resolve('discard'); await pending })
  expect(view.result.current.documents).toHaveLength(3)
})
