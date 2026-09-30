import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPresentation, ArtifactRecord, ChatFileRecord } from '../../../types'
import { BundleExchangeBar, ChatArtifactLibrary, ReturnedArtifactGallery } from './BundleExplorer'
import { ARTIFACT_INDEX_EVENT, type ArtifactIndexRequest } from '../../../lib/artifacts/bundles/artifactIndexing'

const mocks = vi.hoisted(() => ({
  artifactEntries: vi.fn(async () => ({ entries: [{ path: 'turn.json', size: 42, dir: false }] })),
  artifactPresentation: vi.fn(async (): Promise<ArtifactPresentation> => ({ protocol: 'harness.artifact-presentation/v1', fallback: true, galleries: [] as ArtifactPresentation['galleries'] })),
  chatFiles: vi.fn(async () => ({ files: [] as ChatFileRecord[] })),
  saveChatFileToLibrary: vi.fn(async () => ({})),
}))
vi.mock('../../../lib/transport/http/api', () => ({ api: {
  artifactEntries: mocks.artifactEntries,
  artifactPresentation: mocks.artifactPresentation,
  chatFiles: mocks.chatFiles,
  saveChatFileToLibrary: mocks.saveChatFileToLibrary,
  artifactURL: (_sessionId: string, artifactId: string, preview = false) => `/artifact/${artifactId}${preview ? '?preview=1' : ''}`,
  artifactEntryURL: (_sessionId: string, artifactId: string, path: string) => `/artifact/${artifactId}/entry?path=${encodeURIComponent(path)}`,
} }))

afterEach(() => {
  cleanup()
  mocks.artifactEntries.mockClear()
  mocks.artifactPresentation.mockClear()
  mocks.chatFiles.mockReset()
  mocks.chatFiles.mockResolvedValue({ files: [] })
  mocks.saveChatFileToLibrary.mockClear()
})

describe('BundleExchangeBar', () => {
  it('shows exchange metadata and opens the bundle file explorer', async () => {
    const bundle: ArtifactRecord = {
      id: 'artifact_1', request_id: 'req_20260905T220000_1234567890abcdef', direction: 'input', kind: 'bundle', name: 'whx_bundle_req_chat-1_req_20260905T220000_1234567890abcdef.zip', content_type: 'application/zip',
      size: 2048, sha256: 'a'.repeat(64), created_at: '2026-09-05T22:00:00Z', expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1,
    }
    render(<BundleExchangeBar sessionId="ses_1" artifacts={[bundle]} />)
    expect(screen.getByText('whx_bundle_req_chat-1_req_20260905T220000_1234567890abcdef.zip')).toBeTruthy()
    expect(screen.getByText(/2.0 KB/)).toBeTruthy()
    fireEvent.click(screen.getByTitle('Explorar whx_bundle_req_chat-1_req_20260905T220000_1234567890abcdef.zip'))
    await waitFor(() => expect(mocks.artifactEntries).toHaveBeenCalledWith('ses_1', 'artifact_1'))
    expect(await screen.findByText('turn.json')).toBeTruthy()
    expect(screen.getByText('Bundle inteiro')).toBeTruthy()
    expect(document.querySelector('.bundle-explorer-backdrop')?.parentElement).toBe(document.body)
  })
  it('ignores auxiliary ZIP artifacts even when legacy metadata marks them as bundles', () => {
    const requestId = 'req_20260905T220000_1234567890abcdef'
    const base = { content_type: 'application/zip', size: 1024, sha256: 'c'.repeat(64), created_at: '2026-09-05T22:00:00Z', expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1 }
    const artifacts: ArtifactRecord[] = [
      { ...base, id: 'transport', request_id: requestId, direction: 'input', kind: 'bundle', name: `whx_bundle_req_chat-1_${requestId}.zip` },
      { ...base, id: 'legacy-context', request_id: requestId, direction: 'input', kind: 'bundle', name: `context-${requestId}.zip` },
      { ...base, id: 'legacy-session-context', request_id: requestId, direction: 'input', kind: 'bundle', name: 'wharness-context-ses_123.zip' },
      { ...base, id: 'wrong-direction', request_id: requestId, direction: 'output', kind: 'bundle', name: `whx_bundle_req_chat-1_${requestId}.zip` },
      { ...base, id: 'wrong-request', request_id: 'req_20260905T220001_fedcba0987654321', direction: 'input', kind: 'bundle', name: `whx_bundle_req_chat-1_${requestId}.zip` },
      { ...base, id: 'typed-context', request_id: requestId, direction: 'input', kind: 'context', name: `whx_bundle_req_chat-1_${requestId}.zip` },
    ]

    render(<BundleExchangeBar sessionId="ses_1" artifacts={artifacts} />)
    expect(screen.getByText(`whx_bundle_req_chat-1_${requestId}.zip`)).toBeTruthy()
    expect(screen.queryByText(`context-${requestId}.zip`)).toBeNull()
    expect(screen.queryByText('wharness-context-ses_123.zip')).toBeNull()
    expect(screen.queryByRole('button', { name: /Abrir galeria completa/i })).toBeNull()
    expect(document.querySelector('.bundle-exchange-summary')).toBeNull()
    expect(document.querySelector('.bundle-exchange-stats')).toBeNull()
    expect(document.querySelector('.bundle-quota-indicator')).toBeNull()
    expect(screen.queryByText('Todos')).toBeNull()
  })

  it('assigns a distinct visual category to semantic bundle types', async () => {
    const base = { kind: 'bundle', content_type: 'application/zip', size: 2048, sha256: 'b'.repeat(64), expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1 }
    const specs = [
      ['main', 'input', 'main_request', 'main-request'], ['response', 'output', 'response', 'response'],
      ['correction', 'input', 'correction', 'correction'], ['adjustment', 'input', 'adjustment', 'adjustment'], ['debug-ping', 'output', 'debug_ping', 'debug-ping'],
      ['debug-pong', 'input', 'debug_pong', 'debug-pong'], ['plan', 'output', 'plan', 'plan'],
      ['plan-approval', 'input', 'plan_approval', 'plan-approval'], ['plan-correction', 'input', 'plan_correction', 'plan-correction'],
      ['restore', 'input', 'revert_restore', 'restore'], ['improvement', 'input', 'improvement', 'improvement'],
      ['conflict', 'input', 'conflict', 'conflict'], ['knowledge-review', 'input', 'knowledge_review', 'knowledge-review'],
      ['knowledge-consolidation', 'input', 'knowledge_consolidation', 'knowledge-consolidation'], ['clarification', 'output', 'clarification', 'clarification'],
      ['investigation', 'output', 'investigation', 'investigation'], ['blocked', 'output', 'blocked', 'blocked'],
      ['final-summary', 'output', 'final_summary', 'final-summary'],
    ] as const
    const artifacts: ArtifactRecord[] = specs.map(([id, direction, bundleType], index) => {
      const requestId = `req_20260905T${String(180000 + index).padStart(6, '0')}_${String(index + 1).padStart(16, '1')}`
      return {
        ...base, id, request_id: requestId, direction, bundle_type: bundleType,
        name: `whx_bundle_${direction === 'input' ? 'req' : 'res'}_chat-1_${requestId}.zip`, created_at: `2026-09-05T${String(18 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z`,
      }
    })

    const view = render(<BundleExchangeBar sessionId="ses_1" artifacts={artifacts} />)
    expect(view.container.querySelector('.bundle-tone-final-summary')).toBeTruthy()
    expect(view.container.querySelector('.bundle-tone-blocked')).toBeTruthy()
    expect(view.container.querySelector('.bundle-tone-investigation')).toBeTruthy()

    const selected = artifacts[artifacts.length - 1]
    fireEvent.click(screen.getByTitle(`Explorar ${selected.name}`))
    await waitFor(() => expect(mocks.artifactEntries).toHaveBeenCalledWith('ses_1', 'final-summary'))
    const selector = document.querySelector('.bundle-selector')!
    for (const [, , bundleType, tone] of specs) {
      expect(selector.querySelector(`.bundle-tone-${tone}`)).toBeTruthy()
      expect(screen.getAllByText(bundleType).length).toBeGreaterThan(0)
    }
  })

  it('shows chat files from the backend, keeps protocol bundles, and can save a file to the library', async () => {
    const requestId = 'req_20260905T225500_5555555555555555'
    const input: ArtifactRecord = {
      id: 'input-bundle', request_id: requestId, direction: 'input', kind: 'bundle', name: `whx_bundle_req_chat-1_${requestId}.zip`, content_type: 'application/zip',
      size: 2048, sha256: 'e'.repeat(64), created_at: '2026-09-05T22:55:00Z', expires_at: '2026-10-05T22:55:00Z', bundle: true, entry_count: 2,
    }
    const output: ArtifactRecord = { ...input, id: 'output-bundle', direction: 'output', name: `whx_bundle_res_chat-1_${requestId}.zip`, created_at: '2026-09-05T22:56:00Z' }
    mocks.chatFiles.mockResolvedValueOnce({ files: [
      { artifact_id: 'attachment-1', request_id: requestId, direction: 'input', source: 'attachment', name: 'brief.pdf', content_type: 'application/pdf', size: 128, created_at: '2026-09-05T22:55:00Z', direct: true },
      { artifact_id: 'output-bundle', request_id: requestId, direction: 'output', source: 'returned', name: 'chart.png', path: 'artifacts/chart.png', content_type: 'image/png', size: 512, created_at: '2026-09-05T22:56:00Z', direct: false },
    ] satisfies ChatFileRecord[] })

    render(<ChatArtifactLibrary sessionId="ses_1" artifacts={[input, output]} />)

    const briefName = await screen.findByText('brief.pdf')
    const chartName = screen.getByText('chart.png')
    expect(screen.getByText(input.name)).toBeTruthy()
    expect(screen.getByText(output.name)).toBeTruthy()
    expect(mocks.chatFiles).toHaveBeenCalledWith('ses_1')

    const briefCard = briefName.closest('.chat-file-card') as HTMLElement
    const chartCard = chartName.closest('.chat-file-card') as HTMLElement
    expect(briefCard.querySelector('.chat-file-generic-thumb')?.textContent).toContain('PDF')
    expect(briefCard.querySelector('img')).toBeNull()
    expect(briefCard.querySelector('video')).toBeNull()
    expect(chartCard.querySelector('.chat-file-media-thumb img')).toBeTruthy()

    const indexed: ArtifactIndexRequest[] = []
    window.addEventListener(ARTIFACT_INDEX_EVENT, (event: Event) => {
      indexed.push((event as CustomEvent<ArtifactIndexRequest>).detail)
    }, { once: true })
    fireEvent.click(chartCard.querySelector('button[title="Inserir @chat no composer"]') as HTMLButtonElement)
    expect(indexed).toEqual([{ kind: 'chat', value: 'entry|output-bundle|artifacts/chart.png' }])

    fireEvent.click(chartCard.querySelector('button[title="Guardar na biblioteca"]') as HTMLButtonElement)
    await waitFor(() => expect(mocks.saveChatFileToLibrary).toHaveBeenCalledWith('ses_1', 'output-bundle', 'artifacts/chart.png'))

    fireEvent.click(screen.getByTitle('Tabela'))
    expect(screen.getByRole('table', { name: 'Tabela de ficheiros do chat' })).toBeTruthy()
    let rows = Array.from(document.querySelectorAll<HTMLElement>('.chat-file-table-row'))
    expect(rows[0]?.textContent).toContain('chart.png')
    expect(rows[0]?.querySelector('.chat-file-table-thumb img')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por ficheiro' }))
    rows = Array.from(document.querySelectorAll<HTMLElement>('.chat-file-table-row'))
    expect(rows[0]?.textContent).toContain('brief.pdf')
    expect(rows[0]?.querySelector('.chat-file-table-thumb .chat-file-generic-thumb')?.textContent).toContain('PDF')

    fireEvent.change(screen.getByLabelText('Pesquisar ficheiros deste chat'), { target: { value: 'chart' } })
    expect(screen.queryByText('brief.pdf')).toBeNull()
    expect(screen.getByText('chart.png')).toBeTruthy()
  })

  it('renders user-facing files from artifacts/ in the matching response bundle', async () => {
    const requestId = 'req_20260905T230000_4444444444444444'
    const bundle: ArtifactRecord = {
      id: 'response-artifacts', request_id: requestId, direction: 'output', kind: 'bundle', name: `whx_bundle_res_chat-1_${requestId}.zip`, content_type: 'application/zip',
      size: 4096, sha256: 'd'.repeat(64), created_at: '2026-09-05T23:00:00Z', expires_at: '2026-10-05T23:00:00Z', bundle: true, entry_count: 3,
    }
    mocks.artifactPresentation.mockResolvedValueOnce({
      protocol: 'harness.artifact-presentation/v1', fallback: false, galleries: [{
        id: 'mixed', title: 'Resultados', description: 'Conteúdo misto', layout: 'grid', sizing: 'adaptive', items: [
          { path: 'artifacts/preview.png', label: 'Pré-visualização', description: 'Imagem gerada', size: 512, content_type: 'image/png', kind: 'image' },
          { path: 'artifacts/report.md', size: 256, content_type: 'text/markdown', kind: 'markdown' },
        ],
      }],
    })

    const view = render(<ReturnedArtifactGallery sessionId="ses_1" artifacts={[bundle]} requestId={requestId} />)

    expect(await screen.findByText('Artefactos devolvidos')).toBeTruthy()
    expect(screen.getByText('Resultados')).toBeTruthy()
    expect(screen.getByText('Pré-visualização')).toBeTruthy()
    expect(screen.getByText('report.md')).toBeTruthy()
    expect(screen.getByText('Imagem gerada')).toBeTruthy()
    expect(mocks.artifactPresentation).toHaveBeenCalledWith('ses_1', 'response-artifacts')
    view.rerender(<ReturnedArtifactGallery sessionId="ses_1" artifacts={[{ ...bundle }]} requestId={requestId} />)
    expect(mocks.artifactPresentation).toHaveBeenCalledTimes(1)
    expect(document.querySelector('img')?.getAttribute('src')).toContain('artifacts%2Fpreview.png')
  })

})
