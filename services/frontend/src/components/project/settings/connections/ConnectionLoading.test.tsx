import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteStorageSettings } from '../RemoteStorageSettings'
import { TunnelProviderSettings } from '../TunnelProviderSettings'
import { api } from '../../../../lib/transport/http/api'

vi.mock('../../../../lib/transport/http/api', () => ({ api: {
  remoteStorageConfig: vi.fn(), remoteStorageProviders: vi.fn(async () => ({ providers: [] })),
  tunnelConfig: vi.fn(), tunnelProviders: vi.fn(async () => ({ providers: [] })),
  config: vi.fn(async () => ({ planner: 'manual', sandbox: 'docker', model: '', api_configured: false, chatgpt_web_embed: false })),
} }))
afterEach(() => vi.clearAllMocks())
describe('connection settings loading', () => {
  it('shows storage load failures and retries without initiating authentication', async () => {
    vi.mocked(api.remoteStorageConfig).mockRejectedValueOnce(new Error('Storage indisponível')).mockResolvedValueOnce({ config: { version: 1, instances: [] }, restart_required: false })
    render(<RemoteStorageSettings onError={vi.fn()}/>)
    expect(await screen.findByText('Storage indisponível')).toBeTruthy()
    expect(screen.queryByText('A carregar providers…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Sem storage remoto configurado')).toBeTruthy()
    expect(api.remoteStorageConfig).toHaveBeenCalledTimes(2)
  })
  it('shows tunnel load failures and retries without publishing a tunnel', async () => {
    vi.mocked(api.tunnelConfig).mockRejectedValueOnce(new Error('Túnel indisponível')).mockResolvedValueOnce({ config: { version: 1, instance_name: 'Atlas', instances: [] }, restart_required: false })
    render(<TunnelProviderSettings onError={vi.fn()}/>)
    expect(await screen.findByText('Túnel indisponível')).toBeTruthy()
    expect(screen.queryByText('A carregar providers de túnel…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Transporte direto por ficheiros')).toBeTruthy()
    expect(api.tunnelConfig).toHaveBeenCalledTimes(2)
  })
})
