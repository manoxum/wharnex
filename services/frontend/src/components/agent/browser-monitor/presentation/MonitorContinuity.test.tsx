import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserMonitor } from '../BrowserMonitor'
import { bridge } from '../../../chatgpt/surface/chatGPTDesktopPaneTestFixtures'

vi.mock('../../../../lib/transport/http/api', () => ({ api: { managedArtifacts: vi.fn(async () => ({ artifacts: [] })) } }))
afterEach(() => { localStorage.removeItem('wharnex.browser-monitor.layout.v1'); delete window.wharnessDesktop; vi.unstubAllGlobals() })
describe('monitor concentration', () => {
  it('keeps its native browser presented while concentrating and restoring panels', async () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    const desktop = bridge()
    window.wharnessDesktop = desktop
    render(<BrowserMonitor/>)
    await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-1', expect.any(Object)))
    const nativeHost = screen.getByLabelText('Navegador real de Worker 1')
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar navegador' }))
    expect(screen.getByLabelText('Navegador real de Worker 1')).toBe(nativeHost)
    expect(desktop.agents.releaseFromMonitor).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Expandir painel de detalhes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar painéis' }))
    expect(screen.getByRole('button', { name: 'Recolher painel de detalhes' })).toBeTruthy()
    expect(desktop.agents.snapshot).not.toHaveBeenCalled()
  })
})
