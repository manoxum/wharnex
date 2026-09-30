import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { RemoteStorageSettings } from './RemoteStorageSettings'

vi.mock('../../../lib/transport/http/api', () => ({
  api: {
    remoteStorageConfig: vi.fn(),
    remoteStorageProviders: vi.fn(),
    connectRemoteStorage: vi.fn(),
    checkRemoteStorage: vi.fn(),
    updateRemoteStorageConfig: vi.fn(),
  },
}))

describe('RemoteStorageSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.remoteStorageConfig).mockResolvedValue({ config: { version: 1, instances: [] }, restart_required: false })
    vi.mocked(api.remoteStorageProviders).mockResolvedValue({ providers: [{ id: 'drive', name: 'Google Drive', description: 'Conta Google', auth_mode: 'oauth_browser', available: true, fields: [] }] })
    vi.mocked(api.connectRemoteStorage).mockImplementation(async (instanceID, provider) => ({ provider, remote: `wharness-${instanceID}`, connected: true }))
    vi.mocked(api.checkRemoteStorage).mockResolvedValue({ connected: true })
    vi.mocked(api.updateRemoteStorageConfig).mockImplementation(async (config) => ({ config, restart_required: true }))
  })

  it('configures several instances and persists per-account priority and limits', async () => {
    const onError = vi.fn()
    render(<RemoteStorageSettings onError={onError}/>)

    expect(await screen.findByText('Sem storage remoto configurado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Escolher provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /Google Drive Conta Google/i }))
    fireEvent.click(screen.getByRole('button', { name: /Ligar Google Drive/i }))
    await waitFor(() => expect(api.connectRemoteStorage).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Adicionar provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /Google Drive Conta Google/i }))
    fireEvent.click(screen.getByRole('button', { name: /Ligar Google Drive/i }))
    await waitFor(() => expect(api.connectRemoteStorage).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getAllByText('Limites desta conta')[0])
    fireEvent.change(screen.getAllByLabelText('Requisições')[0], { target: { value: '25' } })
    fireEvent.change(screen.getAllByLabelText(/Janela/i)[0], { target: { value: '3600' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))

    await waitFor(() => expect(api.updateRemoteStorageConfig).toHaveBeenCalledTimes(1))
    const document = vi.mocked(api.updateRemoteStorageConfig).mock.calls[0][0]
    expect(document.instances).toHaveLength(2)
    expect(document.instances[0].priority).toBe(10)
    expect(document.instances[0].limits.max_requests).toBe(25)
    expect(document.instances[1].rclone_remote).toBe('wharness-drive-2')
    expect(await screen.findByText('Configuração guardada')).toBeTruthy()
    expect(onError).not.toHaveBeenCalled()
  })

  it('enrolls S3 credentials from the frontend without persisting secrets in the pool', async () => {
    vi.mocked(api.remoteStorageProviders).mockResolvedValue({ providers: [{
      id: 's3', name: 'Amazon S3 / compatível', description: 'AWS ou MinIO', auth_mode: 'credentials', available: true,
      fields: [{ id: 'access_key_id', label: 'Access key', required: true }, { id: 'secret_access_key', label: 'Secret key', required: true, secret: true }],
    }] })
    const onError = vi.fn()
    render(<RemoteStorageSettings onError={onError}/>)

    fireEvent.click(await screen.findByRole('button', { name: /Escolher provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /Amazon S3.*AWS ou MinIO/i }))
    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'access-value' } })
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar e ligar/i }))

    await waitFor(() => expect(api.connectRemoteStorage).toHaveBeenCalledWith('s3-1', 's3', { access_key_id: 'access-value', secret_access_key: 'secret-value' }))
    fireEvent.change(screen.getByLabelText(/URL pública da pasta/i), { target: { value: 'https://files.example/wharness' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuração/i }))
    await waitFor(() => expect(api.updateRemoteStorageConfig).toHaveBeenCalledTimes(1))
    const persisted = vi.mocked(api.updateRemoteStorageConfig).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(JSON.stringify(persisted)).not.toContain('secret-value')
    expect(onError).not.toHaveBeenCalled()
  })

  it('accepts the null fields emitted for OAuth providers by the backend', async () => {
    vi.mocked(api.remoteStorageProviders).mockResolvedValue({ providers: [{
      id: 'drive', name: 'Google Drive', description: 'Conta Google', auth_mode: 'oauth_browser', available: true, fields: null,
    }] as never })
    render(<RemoteStorageSettings onError={() => undefined}/>)

    fireEvent.click(await screen.findByRole('button', { name: /Escolher provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /Google Drive Conta Google/i }))

    expect(screen.getByRole('button', { name: /Ligar Google Drive/i })).toBeTruthy()
  })
})
