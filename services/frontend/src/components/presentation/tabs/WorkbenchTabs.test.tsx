import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { WorkbenchTabs, TabBar, TabButton } from './index'
import { tabDensity } from './tabDensity'

afterEach(cleanup)
const items = [
  { id: 'changes', label: 'Alterações', icon: 'edit', badge: 0 },
  { id: 'history', label: 'Histórico', icon: 'history', badge: 50 },
  { id: 'settings', label: 'Definições', icon: 'settings', disabled: true },
] as const

function Example() {
  const [tab, setTab] = useState<string>('changes')
  return <WorkbenchTabs label="Secções do Git" value={tab} onChange={setTab} items={items}/>
}

describe('canonical workbench tabs', () => {
  it('keeps icons, accessible labels, optional zero badges and one selected tab stop', () => {
    render(<Example/>)
    const changes = screen.getByRole('tab', { name: 'Alterações' })
    expect(changes.getAttribute('aria-selected')).toBe('true')
    expect(changes.tabIndex).toBe(0)
    expect(changes.title).toBe('Alterações')
    expect(changes.querySelector('[data-tab-icon] svg')).not.toBeNull()
    expect(changes.querySelector('[data-tab-badge]')?.textContent).toBe('0')
    expect(screen.getByRole('tab', { name: 'Definições' }).querySelector('[data-tab-badge]')).toBeNull()
    expect(changes.className).toContain('aria-selected:after:bg-[var(--theme-tab-active)]')
    expect(changes.className).toContain('after:bottom-0')
    expect(changes.className).toContain('after:h-0.5')
    expect(changes.className).toContain('rounded-none')
  })

  it('selects with arrows/Home/End, wraps and skips disabled tabs', () => {
    render(<Example/>)
    const changes = screen.getByRole('tab', { name: 'Alterações' })
    const history = screen.getByRole('tab', { name: 'Histórico' })
    changes.focus()
    fireEvent.keyDown(changes, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(history)
    expect(history.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(history, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(changes)
    fireEvent.keyDown(changes, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(history)
    fireEvent.keyDown(history, { key: 'Home' })
    expect(document.activeElement).toBe(changes)
    fireEvent.keyDown(changes, { key: 'End' })
    expect(document.activeElement).toBe(history)
  })

  it('collapses in order and restores labels and badges when space returns', () => {
    const widths = { full: 450, compact: 190 }
    expect([600, 450, 449, 190, 189, 60, 200, 500].map((width) => tabDensity(width, widths)))
      .toEqual(['full', 'full', 'compact', 'compact', 'icons', 'icons', 'compact', 'full'])
  })

  it('keeps resource close actions separate from tab selection and keyboard navigation', () => {
    const select = vi.fn(); const close = vi.fn()
    render(<TabBar label="Ficheiros"><div><TabButton label="main.go" icon="file" selected onClick={select}/><button onClick={close}>Fechar main.go</button></div><TabButton label="test.go" icon="file" selected={false} onClick={select}/></TabBar>)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar main.go' }))
    expect(close).toHaveBeenCalledOnce()
    expect(select).not.toHaveBeenCalled()
    const file = screen.getByRole('tab', { name: 'main.go' })
    fireEvent.keyDown(file, { key: 'ArrowRight' })
    expect(select).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
