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

describe('TunnelProviderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
		vi.mocked(api.tunnelConfig).mockResolvedValue({ config: { version: 1, instance_name: 'Oficina', instances: [] }, restart_required: false })
	vi.mocked(api.config).mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: '', api_configured: false, chatgpt_web_embed: false })
    vi.mocked(api.tunnelProviders).mockResolvedValue({ providers: [{ id: 'trycloudflare', name: 'Cloudflare Quick Tunnel', description: 'Túnel de sessão', auth_mode: 'none', permanent_dns: false, available: true, fields: [] }] })
    vi.mocked(api.updateTunnelConfig).mockImplementation(async (config) => ({ config, restart_required: true }))
	vi.mocked(api.disconnectTunnelProvider).mockResolvedValue(undefined)
  })

  it('keeps tunnel providers separate from storage drivers', async () => {
    render(<TunnelProviderSettings onError={vi.fn()}/>)
    expect(await screen.findByText('Transporte direto por ficheiros')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Adicionar provider/i }))
    expect(screen.getByText('O catálogo não inclui drivers de armazenamento.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Cloudflare Quick Tunnel/i }))
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))
    await waitFor(() => expect(api.updateTunnelConfig).toHaveBeenCalledWith({ version: 1, instance_name: 'Oficina', instances: [{ id: 'trycloudflare-1', provider: 'trycloudflare', priority: 10 }] }))
  })

  it('saves tunnel.pyjam.as without an account or a pinned origin', async () => {
    vi.mocked(api.tunnelProviders).mockResolvedValue({ providers: [{ id: 'pyjamas', name: 'tunnel.pyjam.as', description: 'WireGuard em espaço de utilizador', auth_mode: 'none', permanent_dns: false, available: true, fields: [] }] })
    render(<TunnelProviderSettings onError={vi.fn()}/>)
    expect(await screen.findByText('Transporte direto por ficheiros')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Adicionar provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /tunnel\.pyjam\.as/i }))
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))
    await waitFor(() => expect(api.updateTunnelConfig).toHaveBeenCalledWith({ version: 1, instance_name: 'Oficina', instances: [{ id: 'pyjamas-1', provider: 'pyjamas', priority: 10 }] }))
  })

  it('enrolls a permanent provider without persisting the account token', async () => {
    vi.mocked(api.tunnelProviders).mockResolvedValue({ providers: [{ id: 'cloudflare_named', name: 'Cloudflare Named Tunnel', description: 'DNS permanente', auth_mode: 'token', permanent_dns: true, available: true, fields: [{ id: 'token', label: 'Tunnel token', secret: true, required: true }, { id: 'public_url', label: 'Hostname público', required: true }, { id: 'local_port', label: 'Porta local', required: true }] }] })
    vi.mocked(api.connectTunnelProvider).mockResolvedValue({ provider: 'cloudflare_named', credential_ref: 'cloudflare_named-1', public_url: 'https://agent.example.com', local_port: 43127 })
    render(<TunnelProviderSettings onError={vi.fn()}/>)
    await screen.findByText('Transporte direto por ficheiros')
    fireEvent.click(screen.getByRole('button', { name: /Adicionar provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /Cloudflare Named Tunnel/i }))
    fireEvent.change(screen.getByLabelText('Tunnel token'), { target: { value: 'secret-token' } })
    fireEvent.change(screen.getByLabelText('Hostname público'), { target: { value: 'https://agent.example.com' } })
    fireEvent.change(screen.getByLabelText('Porta local'), { target: { value: '43127' } })
    fireEvent.click(screen.getByRole('button', { name: /Ligar conta e DNS/i }))
    await waitFor(() => expect(api.connectTunnelProvider).toHaveBeenCalledWith('cloudflare_named-1', 'cloudflare_named', { token: 'secret-token', public_url: 'https://agent.example.com', local_port: '43127' }))
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))
    await waitFor(() => expect(api.updateTunnelConfig).toHaveBeenCalledWith({ version: 1, instance_name: 'Oficina', instances: [{ id: 'cloudflare_named-1', provider: 'cloudflare_named', priority: 10, credential_ref: 'cloudflare_named-1', public_url: 'https://agent.example.com', local_port: 43127 }] }))
    expect(JSON.stringify(vi.mocked(api.updateTunnelConfig).mock.calls)).not.toContain('secret-token')
  })

  it('configures a standalone Tailscale Funnel without storing account credentials', async () => {
    vi.mocked(api.tunnelProviders).mockResolvedValue({ providers: [{ id: 'tailscale_funnel', name: 'Tailscale Funnel', description: 'Standalone .ts.net', auth_mode: 'local', auth_url: 'https://login.tailscale.com/admin', permanent_dns: true, available: true, fields: [{ id: 'public_url', label: 'URL pública .ts.net', required: true }, { id: 'local_port', label: 'Porta local do Funnel', required: true }] }] })
    render(<TunnelProviderSettings onError={vi.fn()}/>)
    await screen.findByText('Transporte direto por ficheiros')
    fireEvent.click(screen.getByRole('button', { name: /Adicionar provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /Tailscale Funnel/i }))
    expect(screen.getByRole('link', { name: /Abrir autenticação no navegador/i }).getAttribute('href')).toBe('https://login.tailscale.com/admin')
    fireEvent.change(screen.getByLabelText('URL pública .ts.net'), { target: { value: 'https://machine.tailnet.ts.net' } })
    fireEvent.change(screen.getByLabelText('Porta local do Funnel'), { target: { value: '43127' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))
    await waitFor(() => expect(api.updateTunnelConfig).toHaveBeenCalledWith({ version: 1, instance_name: 'Oficina', instances: [{ id: 'tailscale_funnel-1', provider: 'tailscale_funnel', priority: 10, public_url: 'https://machine.tailnet.ts.net', local_port: 43127 }] }))
  })

  it('notifies the open workspace after a removed tunnel is saved', async () => {
    vi.mocked(api.tunnelConfig).mockResolvedValue({
      config: { version: 1, instance_name: 'Oficina', instances: [{ id: 'trycloudflare-1', provider: 'trycloudflare', priority: 10 }] },
      restart_required: false,
    })
    const onSaved = vi.fn()
    render(<TunnelProviderSettings onError={vi.fn()} onSaved={onSaved}/>)

    await screen.findByDisplayValue('trycloudflare-1')
    fireEvent.click(screen.getByTitle('Remover instância'))
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))

    await waitFor(() => expect(api.updateTunnelConfig).toHaveBeenCalledWith({ version: 1, instance_name: 'Oficina', instances: [] }))
    expect(onSaved).toHaveBeenCalledWith(
      { version: 1, instance_name: 'Oficina', instances: [] },
      expect.any(Object),
    )
  })
})
