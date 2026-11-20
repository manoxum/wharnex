import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShellChrome } from '../shell/WorkspaceShell'
import { setLocalePreference } from '../../../lib/workspace/localization'
beforeEach(() => { localStorage.clear(); setLocalePreference('pt'); delete window.wharnessDesktop })
afterEach(() => { vi.restoreAllMocks(); delete window.wharnessDesktop })
it('keeps header popovers mutually exclusive', async () => {
    render(<ShellChrome projects={['/tmp/alpha']} activeProject="/tmp/alpha" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'alpha' }))
    expect(screen.getByText('Projetos abertos')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Aparência rápida' }))
    expect(screen.queryByText('Projetos abertos')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Aparência rápida' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'alpha' }))
    expect(screen.queryByRole('dialog', { name: 'Aparência rápida' })).toBeNull()
    expect(screen.getByText('Projetos abertos')).toBeTruthy()
  })
