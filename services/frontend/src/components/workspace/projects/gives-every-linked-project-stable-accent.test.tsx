import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShellChrome } from '../shell/WorkspaceShell'
beforeEach(() => { localStorage.clear(); delete window.wharnessDesktop })
afterEach(() => { vi.restoreAllMocks(); delete window.wharnessDesktop })
it('gives every linked project a stable accent and focuses projects owned by another window', async () => {
    const focusProject = vi.fn().mockResolvedValue({ ok: true, windowId: 'window-b', projectPath: '/tmp/beta' })
    window.wharnessDesktop = {
      windows: {
        projects: vi.fn().mockResolvedValue({ currentWindowId: 'window-a', items: [{ windowId: 'window-b', projectPath: '/tmp/beta', focused: false }] }),
        focusProject,
      },
    } as unknown as WharnessDesktopBridge
    const onActivate = vi.fn()

    render(<ShellChrome projects={['/tmp/alpha', '/tmp/gamma']} activeProject="/tmp/alpha" mode="agent" busy={false} onActivate={onActivate} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    const alpha = screen.getByRole('tab', { name: 'alpha' })
    const gamma = screen.getByRole('tab', { name: 'gamma' })
    expect(alpha.parentElement!.style.getPropertyValue('--project-hue')).not.toBe('')
    expect(gamma.parentElement!.style.getPropertyValue('--project-hue')).not.toBe('')
    expect(alpha.parentElement!.style.getPropertyValue('--project-hue')).not.toBe(gamma.parentElement!.style.getPropertyValue('--project-hue'))

    fireEvent.click(alpha)
    expect(await screen.findByText('Outras janelas')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /beta.*Trazer janela para a frente/i }))
    await waitFor(() => expect(focusProject).toHaveBeenCalledWith('/tmp/beta'))
    expect(onActivate).not.toHaveBeenCalledWith('/tmp/beta')
  })
