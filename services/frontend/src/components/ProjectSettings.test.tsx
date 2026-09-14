import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { api } from '../lib/api'
import { ProjectSettings } from './ProjectSettings'

vi.mock('../lib/api', () => ({
  api: {
    projectConfig: vi.fn(),
    contextInspection: vi.fn(),
    refreshContext: vi.fn(),
    updateProjectConfig: vi.fn(),
    storage: vi.fn(),
    clearStorage: vi.fn(),
    artifactSettings: vi.fn().mockResolvedValue({ retention_days: 30, bundle_window_limit: 80 }),
    updateArtifactSettings: vi.fn(),
    remoteStorageConfig: vi.fn(),
    updateRemoteStorageConfig: vi.fn(),
    remoteStorageProviders: vi.fn(),
    connectRemoteStorage: vi.fn(),
    checkRemoteStorage: vi.fn(),
    tunnelConfig: vi.fn(),
    updateTunnelConfig: vi.fn(),
    tunnelProviders: vi.fn(),
    connectTunnelProvider: vi.fn(),
    disconnectTunnelProvider: vi.fn(),
  },
}))

const session: Session = {
  id: 'ses-config',
  project_path: '/tmp/demo',
  state: 'ready',
  execution_mode: 'protected',
  automation_mode: 'manual',
  created_at: new Date().toISOString(),
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
}

describe('ProjectSettings loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(api.contextInspection).mockResolvedValue({
      snapshot_id: 'ctx', sha256: 'abc', project_root: '/tmp/demo', included_files: 0, excluded_items: 0, included_bytes: 0, roots: [], entries: [], rules: [],
    })
    vi.mocked(api.storage).mockResolvedValue({
      total_bytes: 0, state_bytes: 0, context_bytes: 0, sandbox_bytes: 0, orphan_bytes: 0, artifact_bytes: 0, archive_bytes: 0, projects: [],
    })
  })

  it('shows an actionable retry state instead of remaining stuck on loading', async () => {
    vi.mocked(api.projectConfig).mockRejectedValueOnce(new Error('open whaness.yml: no such file or directory')).mockResolvedValueOnce({
      version: 1,
      project: { name: 'demo' },
      context: { auto_exclude: true, max_file_bytes: 2097152, include: [], exclude: [] },
    })
    render(<ProjectSettings session={session} onClose={() => undefined} onSession={() => undefined} onError={() => undefined} />)

    expect(screen.getByText('A carregar configuração…')).toBeTruthy()
    expect(await screen.findByText('Não foi possível carregar a configuração')).toBeTruthy()
    expect(screen.queryByText('A carregar configuração…')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/i }))
    await waitFor(() => expect(screen.getByText('Reconhecimento automático')).toBeTruthy())
    expect(api.projectConfig).toHaveBeenCalledTimes(2)
  })

  it('uses 100% as the midpoint of a 40%-160% interface scale', async () => {
    vi.mocked(api.projectConfig).mockResolvedValue({
      version: 1,
      project: { name: 'demo' },
      context: { auto_exclude: true, max_file_bytes: 2097152, include: [], exclude: [] },
    })
    render(<ProjectSettings session={session} onClose={() => undefined} onSession={() => undefined} onError={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: /Aparência/i }))
    const slider = screen.getByRole('slider', { name: /Tamanho da interface/i })
    expect(slider.getAttribute('min')).toBe('0.4')
    expect(slider.getAttribute('max')).toBe('1.6')
    expect(slider.getAttribute('value')).toBe('1')
    expect(screen.getByText(/reduza até 40% ou amplie até 160%/i)).toBeTruthy()
  })

  it('edits the global three-hour bundle quota without enabling a hard block', async () => {
    vi.mocked(api.projectConfig).mockResolvedValue({
      version: 1,
      project: { name: 'demo' },
      context: { auto_exclude: true, max_file_bytes: 2097152, include: [], exclude: [] },
    })
    vi.mocked(api.updateArtifactSettings).mockResolvedValue({ retention_days: 30, bundle_window_limit: 96 })
    render(<ProjectSettings session={session} onClose={() => undefined} onSession={() => undefined} onError={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: /Dados locais/i }))
    const input = await screen.findByRole('spinbutton', { name: /Máximo de bundles enviados em 3 horas/i })
    fireEvent.change(input, { target: { value: '96' } })
    const quotaSection = screen.getByText('Quota de bundles do ChatGPT').closest('.browser-session-actions')
    fireEvent.click(quotaSection!.querySelector('button')!)
    await waitFor(() => expect(api.updateArtifactSettings).toHaveBeenCalledWith(30, 96))
    expect(screen.getByText(/gera apenas alerta, sem bloquear novos pedidos/i)).toBeTruthy()
  })

  it('excludes an inventory file directly and rebuilds the context', async () => {
    const config = {
      version: 1,
      project: { name: 'demo' },
      context: { auto_exclude: true, max_file_bytes: 2097152, include: [], include_overrides: [], exclude: [] },
    }
    vi.mocked(api.projectConfig).mockResolvedValue(config)
    vi.mocked(api.contextInspection).mockResolvedValue({
      snapshot_id: 'ctx', sha256: 'abc', project_root: '/tmp/demo', included_files: 1, excluded_items: 0, included_bytes: 512,
      roots: [], entries: [{ path: 'src/large.ts', kind: 'file', status: 'included', size: 512, configurable: true }], rules: [],
    })
    vi.mocked(api.updateProjectConfig).mockImplementation(async (_id, next) => ({ config: next, session }))
    render(<ProjectSettings session={session} onClose={() => undefined} onSession={() => undefined} onError={() => undefined} />)

    fireEvent.click(await screen.findByTitle('Excluir src/large.ts'))
    await waitFor(() => expect(api.updateProjectConfig).toHaveBeenCalledWith('ses-config', expect.objectContaining({
      context: expect.objectContaining({ exclude: ['src/large.ts'], include_overrides: [] }),
    })))
  })

})
