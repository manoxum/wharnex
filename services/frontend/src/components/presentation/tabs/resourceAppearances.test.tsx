import type { CSSProperties } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatTabs } from '../../chat/navigation'
import { ProjectTabs } from '../../workspace/projects'
import { TerminalTabBar } from '../../terminal/workspace/TerminalTabBar'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps conversation titles and trailing link state without adaptive icons or badges', () => {
  const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect() {} })
  const onSelect = vi.fn(); const onArchive = vi.fn(); const onSave = vi.fn(); const onKeyDown = vi.fn()
  render(<ChatTabs chats={[
    { id: 'a', sessionId: 'a', title: 'Chat A', createdAt: '', updatedAt: '', chatgptUrl: 'https://chatgpt.com/c/a' },
    { id: 'b', sessionId: 'b', title: 'Chat B', createdAt: '', updatedAt: '' },
  ]} activeId="a" onSelect={onSelect} onArchive={onArchive} onSave={onSave} onTabKeyDown={onKeyDown}/>)
  const strip = screen.getByRole('tablist', { name: 'Conversas abertas' })
  const tab = within(strip).getByRole('tab', { name: 'Chat A' })
  expect(strip.dataset.density).toBe('full')
  expect(observe).not.toHaveBeenCalled()
  expect(tab.querySelector('[data-tab-label]')?.nextElementSibling?.querySelector('.linked')).toBeTruthy()
  expect(tab.querySelector('[data-tab-badge]')).toBeNull()
  expect(tab.querySelector('svg')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar chat Chat A' }))
  fireEvent.click(screen.getByRole('button', { name: 'Fechar e arquivar chat Chat A' }))
  expect(onSave).toHaveBeenCalledWith('a'); expect(onArchive).toHaveBeenCalledWith('a')
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.keyDown(tab, { key: 'ArrowRight' })
  expect(onSelect).toHaveBeenCalledWith('b')
  fireEvent.keyDown(tab, { key: 'ArrowRight', altKey: true })
  expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ altKey: true }), 'a')
})

it('preserves terminal status, rename, close and keyboard selection', () => {
  const onSelect = vi.fn(); const onBeginRename = vi.fn(); const onClose = vi.fn()
  const tabs = [1, 2].map((id) => ({ id, label: `Terminal ${id}`, terminalID: '', cwd: '.', history: '', viewportY: 0, status: 'connected' as const }))
  render(<TerminalTabBar tabs={tabs} activeID={1} editingLabel="" onSelect={onSelect} onBeginRename={onBeginRename} onClose={onClose} onEditingLabel={vi.fn()} onFinishRename={vi.fn()} onCancelRename={vi.fn()}/>)
  const strip = screen.getByRole('tablist', { name: 'Instâncias do terminal' })
  const tab = within(strip).getByRole('tab', { name: 'Terminal 1' })
  expect(strip.dataset.density).toBe('full')
  expect(tab.querySelector('.terminal-status-connected')).toBeTruthy()
  expect(tab.querySelector('[data-tab-badge]')).toBeNull()
  fireEvent.doubleClick(tab); expect(onBeginRename).toHaveBeenCalledWith(tabs[0])
  fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 1' }))
  expect(onClose).toHaveBeenCalledWith(1); expect(onSelect).not.toHaveBeenCalled()
  fireEvent.keyDown(tab, { key: 'End' }); expect(onSelect).toHaveBeenCalledWith(2)
})

it('preserves linked project identity, active menu, unlink and typing attention', () => {
  const onActivate = vi.fn(); const onActiveMenu = vi.fn(); const onUnbind = vi.fn()
  render(<ProjectTabs projects={['/alpha', '/beta']} activeProject="/alpha" composerTypingProject="/alpha" busy={false} projectWindowOpen activeButtonRef={null}
    accentStyle={() => ({ '--project-hue': 210 } as CSSProperties)} projectName={(path) => path.slice(1)} onActivate={onActivate} onActiveMenu={onActiveMenu} onUnbind={onUnbind}/>)
  const strip = screen.getByRole('tablist', { name: 'Projetos vinculados' })
  const active = within(strip).getByRole('tab', { name: 'alpha' })
  expect(strip.dataset.density).toBe('full')
  expect(active.getAttribute('aria-expanded')).toBe('true')
  expect(strip.className).not.toContain('[&>[data-resource-tab]]:w-[160px]')
  expect(active.className).not.toContain('w-full')
  expect(active.querySelector('[data-tab-label]')!.className).not.toContain('truncate')
  expect(active.querySelector('[data-tab-label]')!.className).not.toContain('max-w-')
  expect(active.querySelector('[data-project-mark]')).toBeTruthy()
  expect(active.className).toContain('wharnex-project-composer-pulse')
  expect(within(strip).getByRole('tab', { name: 'beta' }).className).not.toContain('wharnex-project-composer-pulse')
  fireEvent.click(active); expect(onActiveMenu).toHaveBeenCalledWith(active)
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular alpha desta janela' }))
  expect(onUnbind).toHaveBeenCalledWith('/alpha'); expect(onActivate).not.toHaveBeenCalled()
  fireEvent.keyDown(active, { key: 'ArrowRight' }); expect(onActivate).toHaveBeenCalledWith('/beta')
})
