import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { EditorTabs } from './EditorTabs'

afterEach(cleanup)
const documents = [
  { path: 'src/App.tsx', content: '', draft: 'edited', sha256: '', size: 0 },
  { path: 'src/DocumentWithAVeryLongFilename.tsx', content: '', draft: '', sha256: '', size: 0 },
]

it('uses main-branch document chrome with full accessible paths and separate close/save actions', () => {
  const select = vi.fn(); const close = vi.fn(); const save = vi.fn().mockResolvedValue(true)
  render(<EditorTabs documents={documents} activePath={documents[0].path} savingPaths={new Set()} gitByPath={new Map()}
    onSelect={select} onClose={close} onSave={save}/>)
  const strip = screen.getByRole('tablist', { name: 'Ficheiros abertos' })
  expect(strip.getAttribute('data-density')).toBe('full')
  expect(strip.className).not.toContain('160px')
  expect(strip.className).toContain('gap-0')
  for (const document of documents) {
    const tab = screen.getByRole('tab', { name: document.path.split('/').pop() })
    expect(tab.title).toBe(document.path)
    expect(tab.parentElement!.hasAttribute('data-resource-tab')).toBe(true)
    expect(tab.parentElement!.className).toContain('max-w-[230px]')
    expect(tab.parentElement!.className).toContain('h-[36px]')
    expect(tab.querySelector('[data-tab-label]')!.className).toContain('max-w-[150px]')
    expect(tab.querySelector('[data-tab-label]')!.className).toContain('truncate')
  }
  expect(screen.getByRole('tab', { name: 'App.tsx' }).querySelector('.dirty-dot')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar src/App.tsx' }))
  expect(close).toHaveBeenCalledWith('src/App.tsx')
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar agora' }))
  expect(save).toHaveBeenCalledWith('src/App.tsx')
})

it('navigates documents without closing them and keeps exactly one selected tab stop', () => {
  const close = vi.fn()
  function Example() {
    const [active, setActive] = useState(documents[0].path)
    return <EditorTabs documents={documents} activePath={active} savingPaths={new Set()} gitByPath={new Map()}
      onSelect={setActive} onClose={close} onSave={async () => true}/>
  }
  render(<Example/>)
  const first = screen.getByRole('tab', { name: 'App.tsx' })
  const last = screen.getByRole('tab', { name: 'DocumentWithAVeryLongFilename.tsx' })
  first.focus()
  fireEvent.keyDown(first, { key: 'End' })
  expect(document.activeElement).toBe(last)
  expect(last.getAttribute('aria-selected')).toBe('true')
  expect(last.tabIndex).toBe(0)
  expect(first.tabIndex).toBe(-1)
  fireEvent.keyDown(last, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(first)
  expect(first.getAttribute('aria-selected')).toBe('true')
  expect(close).not.toHaveBeenCalled()
})
