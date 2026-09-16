import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedArtifact } from '../types'
import { ArtifactExplorerPanel } from './ArtifactExplorerPanel'

const mocks = vi.hoisted(() => ({
  managedArtifacts: vi.fn(),
  persistArtifact: vi.fn(),
  deleteManagedArtifact: vi.fn(async () => ({ deleted: true })),
  confirmDialog: vi.fn(async () => true),
  storage: vi.fn(async () => ({ total_bytes: 8192, state_bytes: 512, context_bytes: 2048, sandbox_bytes: 1024, artifact_bytes: 4096, archive_bytes: 512, orphan_bytes: 0, projects: [] })),
}))

vi.mock('../lib/api', () => ({ api: {
  managedArtifacts: mocks.managedArtifacts,
  persistArtifact: mocks.persistArtifact,
  deleteManagedArtifact: mocks.deleteManagedArtifact,
  storage: mocks.storage,
  artifactURL: (_sessionId: string, artifactId: string, preview = false) => `/artifact/${artifactId}${preview ? '?preview=1' : ''}`,
} }))
vi.mock('../lib/appDialog', () => ({ confirmDialog: mocks.confirmDialog }))

const artifacts: ManagedArtifact[] = [
  managed('ses_a', '/workspace/alpha', 'artifact_a', 'manual.pdf', 4096, '2026-09-15T22:00:00Z'),
  managed('ses_b', '/workspace/beta', 'artifact_b', 'dados.csv', 1024, '2026-09-10T08:30:00Z'),
]

afterEach(() => {
  cleanup()
  mocks.managedArtifacts.mockReset()
  mocks.persistArtifact.mockReset()
  mocks.deleteManagedArtifact.mockClear()
  mocks.confirmDialog.mockClear()
  mocks.storage.mockClear()
})

describe('ArtifactExplorerPanel', () => {
  it('loads only durable library artifacts and supports search/table view', async () => {
    mocks.managedArtifacts.mockResolvedValue({ artifacts })
    render(<ArtifactExplorerPanel sessionId="ses_current" onError={vi.fn()}/>)

    expect(await screen.findByText('manual.pdf')).toBeTruthy()
    expect(mocks.managedArtifacts).toHaveBeenCalledWith('', false, 'library')
    fireEvent.change(screen.getByLabelText('Pesquisar ficheiros'), { target: { value: 'dados' } })
    expect(screen.queryByText('manual.pdf')).toBeNull()
    expect(screen.getByText('dados.csv')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Tabela'))
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText(/beta/i)).toBeTruthy()
  })

  it('separates durable user files from exchanged bundles and shows disk usage', async () => {
    const bundle = managed('ses_bundle', '/workspace/alpha', 'artifact_bundle', 'whx_bundle_res_demo.zip', 2048, '2026-09-16T08:00:00Z')
    bundle.artifact.bundle = true
    bundle.artifact.kind = 'response_bundle'
    mocks.managedArtifacts.mockImplementation(async (_query: string, bundlesOnly: boolean) => ({ artifacts: bundlesOnly ? [bundle] : artifacts }))
    render(<ArtifactExplorerPanel sessionId="ses_current" onError={vi.fn()}/>)

    expect(await screen.findByText('manual.pdf')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Resumo de ocupação em disco' }).textContent).toMatch(/8(?:\.0)? KB/)
    fireEvent.click(screen.getByRole('tab', { name: /Bundles/ }))
    expect(await screen.findByText('whx_bundle_res_demo.zip')).toBeTruthy()
    expect(mocks.managedArtifacts).toHaveBeenLastCalledWith('', true)
    expect(screen.queryByText('manual.pdf')).toBeNull()
  })

  it('uploads directly to the library and deletes a stored file', async () => {
    mocks.managedArtifacts.mockResolvedValueOnce({ artifacts }).mockResolvedValueOnce({ artifacts }).mockResolvedValueOnce({ artifacts: [artifacts[1]] })
    mocks.persistArtifact.mockResolvedValue(artifacts[0].artifact)
    render(<ArtifactExplorerPanel sessionId="ses_current" onError={vi.fn()}/>)
    await screen.findByText('manual.pdf')

    const file = new File(['hello'], 'novo.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('hello').buffer })
    fireEvent.change(screen.getByLabelText('Carregar ficheiros para a biblioteca'), { target: { files: [file] } })
    await waitFor(() => expect(mocks.persistArtifact).toHaveBeenCalledWith('ses_current', expect.objectContaining({ kind: 'library', filename: 'novo.txt' })))

    fireEvent.click(screen.getByLabelText('Eliminar manual.pdf'))
    await waitFor(() => expect(mocks.deleteManagedArtifact).toHaveBeenCalledWith('ses_a', 'artifact_a'))
    expect(mocks.confirmDialog).toHaveBeenCalledTimes(1)
  })

  it('selects multiple library items and deletes them with one confirmation', async () => {
    mocks.managedArtifacts.mockResolvedValue({ artifacts })
    render(<ArtifactExplorerPanel sessionId="ses_current" onError={vi.fn()}/>)
    await screen.findByText('manual.pdf')

    fireEvent.click(screen.getByLabelText('Selecionar manual.pdf'))
    fireEvent.click(screen.getByLabelText('Selecionar dados.csv'))
    expect(screen.getByText('2 selecionados')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Eliminar selecionados \(2\)/ }))
    await waitFor(() => expect(mocks.deleteManagedArtifact).toHaveBeenCalledTimes(2))
    expect(mocks.deleteManagedArtifact).toHaveBeenCalledWith('ses_a', 'artifact_a')
    expect(mocks.deleteManagedArtifact).toHaveBeenCalledWith('ses_b', 'artifact_b')
    expect(mocks.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Eliminar 2 itens?', confirmLabel: 'Eliminar 2' }))
  })

  it('renders bundles as semantic cards and filters them by a custom date interval', async () => {
    const oldBundle = managed('ses_old', '/workspace/alpha', 'artifact_old', 'whx_bundle_req_old.zip', 2048, '2026-09-10T08:00:00Z')
    oldBundle.artifact.bundle = true
    oldBundle.artifact.kind = 'bundle'
    oldBundle.artifact.request_id = 'req_20260910T080000_old'
    oldBundle.artifact.entry_count = 12
    const recentBundle = managed('ses_recent', '/workspace/alpha', 'artifact_recent', 'whx_bundle_res_recent.zip', 4096, '2026-09-16T08:00:00Z')
    recentBundle.artifact.bundle = true
    recentBundle.artifact.kind = 'bundle'
    recentBundle.artifact.direction = 'output'
    recentBundle.artifact.request_id = 'req_20260916T080000_recent'
    recentBundle.artifact.entry_count = 7
    mocks.managedArtifacts.mockImplementation(async (_query: string, bundlesOnly: boolean) => ({ artifacts: bundlesOnly ? [recentBundle, oldBundle] : artifacts }))
    render(<ArtifactExplorerPanel sessionId="ses_current" onError={vi.fn()}/>)
    await screen.findByText('manual.pdf')

    fireEvent.click(screen.getByRole('tab', { name: /Bundles/ }))
    expect(await screen.findByText('Bundle de resposta')).toBeTruthy()
    expect(screen.getByText('Bundle de pedido')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Janela temporal'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-09-15' } })
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-09-16' } })

    expect(screen.getByText('whx_bundle_res_recent.zip')).toBeTruthy()
    expect(screen.queryByText('whx_bundle_req_old.zip')).toBeNull()
  })
})

function managed(sessionId: string, projectPath: string, artifactId: string, name: string, size: number, createdAt: string): ManagedArtifact {
  return {
    session_id: sessionId,
    project_path: projectPath,
    chat_id: `chat_${sessionId}`,
    artifact: {
      id: artifactId,
      request_id: `req_${artifactId}`,
      direction: 'input',
      kind: 'library',
      name,
      content_type: name.endsWith('.pdf') ? 'application/pdf' : 'text/csv',
      size,
      sha256: artifactId.repeat(8).slice(0, 64).padEnd(64, 'a'),
      created_at: createdAt,
      expires_at: '',
      bundle: false,
    },
  }
}
