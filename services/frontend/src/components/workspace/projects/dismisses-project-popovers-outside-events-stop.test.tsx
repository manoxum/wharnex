import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShellChrome } from '../shell/WorkspaceShell'
import { setLocalePreference } from '../../../lib/workspace/localization'
beforeEach(() => { localStorage.clear(); setLocalePreference('pt'); delete window.wharnessDesktop })
afterEach(() => { vi.restoreAllMocks(); delete window.wharnessDesktop })
it('dismisses project popovers when outside events stop bubbling or the shell loses focus', () => {
    render(<><button type="button" data-testid="outside" onPointerDown={(event) => event.stopPropagation()}>Outside</button><ShellChrome projects={['/tmp/alpha']} activeProject="/tmp/alpha" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} /></>)
    const outside = screen.getByTestId('outside')

    fireEvent.click(screen.getByRole('button', { name: 'Ações de projeto' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(outside)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'alpha' }))
    expect(screen.getByText('Projetos abertos')).toBeTruthy()
    fireEvent.focusIn(outside)
    expect(screen.queryByText('Projetos abertos')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'alpha' }))
    expect(screen.getByText('Projetos abertos')).toBeTruthy()
    fireEvent(window, new Event('blur'))
    expect(screen.queryByText('Projetos abertos')).toBeNull()
  })
