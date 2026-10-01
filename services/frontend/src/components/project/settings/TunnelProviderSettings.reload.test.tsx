import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { TunnelProviderSettings } from './TunnelProviderSettings'

vi.mock('../../../lib/transport/http/api', () => ({
  api: {
    config: vi.fn(),
    tunnelConfig: vi.fn(),
    tunnelProviders: vi.fn(),
    updateTunnelConfig: vi.fn(),
    connectTunnelProvider: vi.fn(),
    disconnectTunnelProvider: vi.fn(),
  },
}))

describe('TunnelProviderSettings reload feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.tunnelConfig).mockResolvedValue({ config: { version: 1, instance_name: 'Oficina', instances: [] }, restart_required: false })
    vi.mocked(api.config).mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: '', api_configured: false, chatgpt_web_embed: false })
    vi.mocked(api.tunnelProviders).mockResolvedValue({ providers: [{ id: 'pyjamas', name: 'tunnel.pyjam.as', description: 'WireGuard', auth_mode: 'none', permanent_dns: false, available: true, fields: [] }] })
    vi.mocked(api.disconnectTunnelProvider).mockResolvedValue(undefined)
  })

  async function saveOneProvider(onSaved = vi.fn()) {
    render(<TunnelProviderSettings onError={vi.fn()} onSaved={onSaved}/>)
    expect(await screen.findByText('Transporte direto por ficheiros')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Adicionar provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /tunnel\.pyjam\.as/i }))
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))
  }

  // A pool adopted on save must confirm it is live, not stay silent.
  it('reports the provider as already active when the runtime adopted it', async () => {
    vi.mocked(api.updateTunnelConfig).mockImplementation(async (config) => ({ config, restart_required: false }))
    await saveOneProvider()
    await waitFor(() => expect(screen.getByText('Configuração guardada')).toBeTruthy())
    expect(screen.getByText('O provider de túnel já está ativo.')).toBeTruthy()
  })

  it('publishes the refreshed runtime snapshot after adding the first tunnel', async () => {
    const onSaved = vi.fn()
    vi.mocked(api.config)
      .mockResolvedValueOnce({ planner: 'manual', sandbox: 'docker', model: '', api_configured: false, chatgpt_web_embed: false })
      .mockResolvedValueOnce({ planner: 'manual', sandbox: 'docker', model: '', api_configured: false, chatgpt_web_embed: false, remote_input: { enabled: true, provider: 'pyjamas', mode: 'tunnel', instances: [{ id: 'pyjamas-1', provider: 'pyjamas', priority: 10, available: true, limits: { max_requests: 0, window_seconds: 0, max_files_per_input: 0, max_file_bytes: 0, max_input_bytes: 0, max_stored_objects: 0, max_storage_bytes: 0 }, usage: { requests_in_window: 0, stored_objects: 0, storage_bytes: 0 } }] } })
    vi.mocked(api.updateTunnelConfig).mockImplementation(async (config) => ({ config, restart_required: false }))

    await saveOneProvider(onSaved)

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onSaved.mock.calls[0][1]?.remote_input?.instances).toMatchObject([{ id: 'pyjamas-1', available: true }])
  })

  // When the runtime could not adopt it, the operator must still be told.
  it('still asks for a restart when the runtime did not adopt the change', async () => {
    vi.mocked(api.updateTunnelConfig).mockImplementation(async (config) => ({ config, restart_required: true }))
    await saveOneProvider()
    await waitFor(() => expect(screen.getByText('Configuração guardada')).toBeTruthy())
    expect(screen.getByText('Reinicie o Wharnex para ativar o novo provider de túnel.')).toBeTruthy()
  })
})
