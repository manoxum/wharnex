import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentsList } from './DocumentsList'
import { EditorDocumentsMenu } from './EditorDocumentsMenu'
import { setLocalePreference } from '../../../../lib/workspace/localization'
afterEach(cleanup)
const documents = Array.from({ length: 45 }, (_, index) => ({ path: `folder${index}/Document${index}.tsx`, content: '', sha256: '', size: 0 }))
it('keeps search separate from the scroll area and starts at the active document', () => {
  const select = vi.fn()
  render(<DocumentsList documents={documents} activePath={documents[20].path} onSelect={select}/> )
  const search = screen.getByRole('combobox')
  const list = screen.getByRole('listbox')
  expect(list.contains(search)).toBe(false)
  expect(list.className).toContain('overflow-y-auto')
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByTitle(documents[21].path).id)
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(select).toHaveBeenCalledWith(documents[21].path)
  fireEvent.change(search, { target: { value: 'folder4/' } })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(select).toHaveBeenLastCalledWith(documents[4].path)
})
it('handles empty search and resets query on reopen', () => {
  const select = vi.fn()
  render(<EditorDocumentsMenu documents={documents} onSelect={select}/> )
  const trigger = screen.getByRole('button', { name: /Selecionar ficheiro aberto/ })
  fireEvent.click(trigger)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'missing' } })
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(select).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  fireEvent.click(trigger)
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('')
})
it('uses English labels while preserving file names and paths', () => {
  setLocalePreference('en')
  render(<DocumentsList documents={[{ ...documents[0], path: 'Guardar/Fechar.tsx', draft: 'new' }]} onSelect={vi.fn()}/> )
  expect(screen.getByRole('combobox', { name: 'Search open files' })).toBeTruthy()
  expect(screen.getByTitle('Guardar/Fechar.tsx').textContent).toContain('Fechar.tsx')
  expect(screen.getByLabelText('Unsaved changes')).toBeTruthy()
})
