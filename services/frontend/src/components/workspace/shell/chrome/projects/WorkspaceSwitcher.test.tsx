import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { LocaleRoot, setLocalePreference } from '../../../../../lib/workspace/localization'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
beforeEach(() => { localStorage.clear(); setLocalePreference('pt') })
function setup() {
  const props = { projects: ['/work/one', '/work/two'], recent: ['/work/recent'], activeProject: '/work/one', otherWindows: [{ windowId: 'other', projectPath: '/work/remote', focused: false }], busy: false, anchor: { left: 9000, top: 9000, width: 100 }, panelRef: createRef<HTMLDivElement>(), onActivate: vi.fn(), onUnbind: vi.fn(), onFocus: vi.fn(), onOpen: vi.fn(), onForget: vi.fn(), onBrowse: vi.fn(), onClose: vi.fn() }
  const view = render(<LocaleRoot>{() => <WorkspaceSwitcher {...props}/>}</LocaleRoot>); return { ...props, ...view }
}
it('searches full paths, selects open projects with keyboard and clamps its window', () => {
  const view = setup()
  const input = screen.getByRole('textbox', { name: 'Pesquisar projetos' })
  expect(document.activeElement).toBe(input)
  const dialog = screen.getByRole('dialog')
  expect(Number.parseFloat(dialog.style.left)).toBeLessThan(window.innerWidth)
  fireEvent.change(input, { target: { value: '/work/two' } })
  expect(screen.queryByTitle('/work/one')).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(view.onActivate).toHaveBeenCalledWith('/work/two')
})
it('persists favorites and separates close, recent removal, opening and other-window focus', () => {
  const view = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Fixar projeto two' }))
  expect(JSON.parse(localStorage.getItem('wharnex.workspace.favorites.v1')!)).toEqual(['/work/two'])
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular one pelo menu de projetos' }))
  expect(view.onUnbind).toHaveBeenCalledWith('/work/one')
  fireEvent.click(screen.getByRole('button', { name: 'Remover recent dos recentes' }))
  expect(view.onForget).toHaveBeenCalledWith('/work/recent')
  fireEvent.click(screen.getByTitle('/work/recent')); expect(view.onOpen).toHaveBeenCalledWith('/work/recent')
  fireEvent.click(screen.getByTitle('/work/remote')); expect(view.onFocus).toHaveBeenCalledWith(view.otherWindows[0])
  fireEvent.click(screen.getByRole('button', { name: 'Abrir outro projeto…' })); expect(view.onBrowse).toHaveBeenCalled()
})

it('preserves search and the focused project while the interface language changes', () => {
  setup()
  const search = screen.getByRole('textbox', { name: 'Pesquisar projetos' })
  fireEvent.change(search, { target: { value: '/work/two' } })
  const project = screen.getByTitle('/work/two')
  project.focus()
  act(() => setLocalePreference('en'))
  expect(screen.getByRole('textbox', { name: 'Search projects' })).toBe(search)
  expect((search as HTMLInputElement).value).toBe('/work/two')
  expect(document.activeElement).toBe(project)
  expect(project.isConnected).toBe(true)
})
