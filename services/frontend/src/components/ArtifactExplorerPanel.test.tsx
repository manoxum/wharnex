import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedArtifact } from '../types'
import { ArtifactExplorerPanel } from './ArtifactExplorerPanel'

const mocks = vi.hoisted(() => ({
  managedArtifacts: vi.fn(),
  deleteManagedArtifact: vi.fn(async () => ({ deleted: true })),
  artifactEntries: vi.fn(async () => ({ entries: [{ path: 'turn.json', size: 42, dir: false }] })),
  confirmDialog: vi.fn(async () => true),
}))

vi.mock('../lib/api', () => ({ api: {
  managedArtifacts: mocks.managedArtifacts,
  deleteManagedArtifact: mocks.deleteManagedArtifact,
  artifactEntries: mocks.artifactEntries,
  artifactURL: (_sessionId: string, artifactId: string) => `/artifact/${artifactId}`,
  artifactEntryURL: (_sessionId: string, artifactId: string, path: string) => `/artifact/${artifactId}/entry?path=${encodeURIComponent(path)}`,
} }))
vi.mock('../lib/appDialog', () => ({ confirmDialog: mocks.confirmDialog }))

const artifacts: ManagedArtifact[] = [
  managed('ses_a', '/workspace/alpha', 'artifact_a', 'alpha-response.zip', 'output', 4096, '2026-09-15T22:00:00Z'),
  managed('ses_b', '/workspace/beta', 'artifact_b', 'beta-request.zip', 'input', 1024, '2026-09-10T08:30:00Z'),
]

afterEach(() => {
  cleanup()
  mocks.managedArtifacts.mockReset()
  mocks.deleteManagedArtifact.mockClear()
  mocks.artifactEntries.mockClear()
  mocks.confirmDialog.mockClear()
})

describe('ArtifactExplorerPanel', () => {
  it('searches, filters and opens a managed artifact in the shared bundle modal', async () => {
    mocks.managedArtifacts.mockResolvedValue({ artifacts })
    render(<ArtifactExplorerPanel onError={vi.fn()}/>)
    expect(await screen.findByText('alpha-response.zip')).toBeTruthy()
    expect(screen.getByText('beta-request.zip')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Pesquisar artefactos'), { target: { value: 'beta' } })
    expect(screen.queryByText('alpha-response.zip')).toBeNull()
    expect(screen.getByText('beta-request.zip')).toBeTruthy()

    fireEvent.click(screen.getByText(/Filtros/))
    const directionFilter = screen.getByLabelText('Direção')
    fireEvent.change(directionFilter, { target: { value: 'input' } })
    fireEvent.change(screen.getByLabelText('Pesquisar artefactos'), { target: { value: '' } })
    expect(screen.queryByText('alpha-response.zip')).toBeNull()
    expect(screen.getByText('beta-request.zip')).toBeTruthy()

    fireEvent.change(directionFilter, { target: { value: 'all' } })
    const periodFilter = screen.getByLabelText('Período')
    fireEvent.change(periodFilter, { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-09-14' } })
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-09-16' } })
    expect(screen.getByText('alpha-response.zip')).toBeTruthy()
    expect(screen.queryByText('beta-request.zip')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    fireEvent.click(screen.getByLabelText('Explorar beta-request.zip'))
    await waitFor(() => expect(mocks.artifactEntries).toHaveBeenCalledWith('ses_b', 'artifact_b'))
    expect(screen.getByRole('dialog', { name: 'Explorar beta-request.zip' })).toBeTruthy()
  })

  it('supports selecting visible artifacts and removing them in bounded batches', async () => {
    mocks.managedArtifacts.mockResolvedValueOnce({ artifacts }).mockResolvedValueOnce({ artifacts: [] })
    render(<ArtifactExplorerPanel onError={vi.fn()}/>)
    await screen.findByText('alpha-response.zip')

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar visíveis' }))
    expect(screen.getByRole('button', { name: /Eliminar 2/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Eliminar 2/ }))

    await waitFor(() => expect(mocks.deleteManagedArtifact).toHaveBeenCalledTimes(2))
    expect(mocks.confirmDialog).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('Nenhum bundle encontrado')).toBeTruthy())
  })
})

function managed(sessionId: string, projectPath: string, artifactId: string, name: string, direction: 'input' | 'output', size: number, createdAt: string): ManagedArtifact {
  return {
    session_id: sessionId,
    project_path: projectPath,
    chat_id: `chat_${sessionId}`,
    artifact: {
      id: artifactId,
      request_id: `req_${artifactId}`,
      direction,
      kind: 'bundle',
      name,
      content_type: 'application/zip',
      size,
      sha256: artifactId.repeat(8).slice(0, 64).padEnd(64, 'a'),
      created_at: createdAt,
      expires_at: '2026-10-15T00:00:00Z',
      bundle: true,
      entry_count: 1,
    },
  }
}
