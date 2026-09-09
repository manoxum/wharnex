import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPresentation, ArtifactRecord } from '../types'
import { BundleExchangeBar, ChatArtifactLibrary, ReturnedArtifactGallery } from './BundleExplorer'

const mocks = vi.hoisted(() => ({
  artifactEntries: vi.fn(async () => ({ entries: [{ path: 'turn.json', size: 42, dir: false }] })),
  artifactPresentation: vi.fn(async (): Promise<ArtifactPresentation> => ({ protocol: 'harness.artifact-presentation/v1', fallback: true, galleries: [] as ArtifactPresentation['galleries'] })),
  bundleQuota: vi.fn(async () => ({ window_hours: 3, limit: 80, sent: 12, received: 11, total: 23, warning: false, window_start: '2026-09-08T15:00:00Z', window_end: '2026-09-08T18:00:00Z' })),
}))
vi.mock('../lib/api', () => ({ api: {
  artifactEntries: mocks.artifactEntries,
  artifactPresentation: mocks.artifactPresentation,
  bundleQuota: mocks.bundleQuota,
  artifactURL: (_sessionId: string, artifactId: string) => `/artifact/${artifactId}`,
  artifactEntryURL: (_sessionId: string, artifactId: string, path: string) => `/artifact/${artifactId}/entry?path=${encodeURIComponent(path)}`,
} }))

afterEach(() => {
  cleanup()
  mocks.artifactEntries.mockClear()
  mocks.artifactPresentation.mockClear()
  mocks.bundleQuota.mockClear()
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
    const summary = screen.getByRole('button', { name: 'Abrir galeria completa: 1 bundle, 1 enviado, 0 recebidos' })
    expect(summary.textContent).not.toContain('Bundles')
    expect(summary.textContent).toBe('1↑1↓0')
    expect(summary.querySelector('.bundle-exchange-stats b')?.textContent).toBe('1')
    expect(screen.queryByText('Todos')).toBeNull()
  })

  it('shows the rolling account quota and warns without blocking at the configured limit', async () => {
    mocks.bundleQuota.mockResolvedValueOnce({ window_hours: 3, limit: 80, sent: 80, received: 77, total: 157, warning: true, window_start: '2026-09-08T15:00:00Z', window_end: '2026-09-08T18:00:00Z' })
    const requestId = 'req_20260905T220000_1234567890abcdef'
    const bundle: ArtifactRecord = {
      id: 'quota-bundle', request_id: requestId, direction: 'input', kind: 'bundle', name: `whx_bundle_req_chat-1_${requestId}.zip`, content_type: 'application/zip',
      size: 1024, sha256: 'a'.repeat(64), created_at: '2026-09-05T22:00:00Z', expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1,
    }
    render(<BundleExchangeBar sessionId="ses_1" artifacts={[bundle]} />)
    expect(await screen.findByText('3h ↑80/80 ↓77')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('80/80')
    expect(screen.getByRole('status', { name: /novos pedidos continuam permitidos/i })).toBeTruthy()
  })

  it('assigns a distinct visual category to every request/response bundle stage', async () => {
    const base = { kind: 'bundle', content_type: 'application/zip', size: 2048, sha256: 'b'.repeat(64), expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1 }
    const mainRequest = 'req_20260905T180000_1111111111111111'
    const repairRequest = 'req_20260905T190000_2222222222222222'
    const summaryRequest = 'req_20260905T210000_3333333333333333'
    const artifacts: ArtifactRecord[] = [
      { ...base, id: 'main', request_id: mainRequest, direction: 'input', name: `whx_bundle_req_chat-1_${mainRequest}.zip`, created_at: '2026-09-05T18:00:00Z' },
      { ...base, id: 'repair', request_id: repairRequest, direction: 'input', name: `whx_bundle_req_chat-1_${mainRequest}_${repairRequest}.zip`, created_at: '2026-09-05T19:00:00Z' },
      { ...base, id: 'response', request_id: repairRequest, direction: 'output', name: `whx_bundle_res_chat-1_${mainRequest}_${repairRequest}.zip`, created_at: '2026-09-05T20:00:00Z' },
      { ...base, id: 'summary-request', request_id: summaryRequest, direction: 'input', name: `whx_bundle_req_chat-1_${mainRequest}_${summaryRequest}.zip`, created_at: '2026-09-05T21:00:00Z' },
      { ...base, id: 'summary-response', request_id: summaryRequest, direction: 'output', name: `whx_bundle_res_chat-1_${mainRequest}_${summaryRequest}.zip`, created_at: '2026-09-05T22:00:00Z' },
    ]
    const requestLineages = {
      [mainRequest]: { request_id: mainRequest, root_request_id: mainRequest, kind: 'standard' as const, created_at: '2026-09-05T18:00:00Z' },
      [repairRequest]: { request_id: repairRequest, root_request_id: mainRequest, parent_request_id: mainRequest, kind: 'repair' as const, created_at: '2026-09-05T19:00:00Z' },
      [summaryRequest]: { request_id: summaryRequest, root_request_id: mainRequest, parent_request_id: mainRequest, kind: 'knowledge_review' as const, created_at: '2026-09-05T21:00:00Z' },
    }

    const view = render(<BundleExchangeBar sessionId="ses_1" artifacts={artifacts} requestLineages={requestLineages} />)
    expect(view.container.querySelector('.bundle-tone-final-summary')).toBeTruthy()
    expect(view.container.querySelector('.bundle-tone-request-summary')).toBeTruthy()
    expect(view.container.querySelector('.bundle-tone-response')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir galeria completa: 5 bundles, 3 enviados, 2 recebidos' }))
    await waitFor(() => expect(mocks.artifactEntries).toHaveBeenCalledWith('ses_1', 'summary-response'))
    const selector = view.container.querySelector('.bundle-selector')!
    expect(selector.querySelector('.bundle-tone-request-main')).toBeTruthy()
    expect(selector.querySelector('.bundle-tone-request-repair')).toBeTruthy()
    expect(selector.querySelector('.bundle-tone-request-summary')).toBeTruthy()
    expect(selector.querySelector('.bundle-tone-response')).toBeTruthy()
    expect(selector.querySelector('.bundle-tone-final-summary')).toBeTruthy()
    expect(screen.getAllByText('Pedido principal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pedido · correção').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pedido · resumo final').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Resposta').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Resumo final').length).toBeGreaterThan(0)
  })

  it('aggregates transport bundles and returned artifacts in the chat file library', async () => {
    const requestId = 'req_20260905T225500_5555555555555555'
    const input: ArtifactRecord = {
      id: 'input-bundle', request_id: requestId, direction: 'input', kind: 'bundle', name: `whx_bundle_req_chat-1_${requestId}.zip`, content_type: 'application/zip',
      size: 2048, sha256: 'e'.repeat(64), created_at: '2026-09-05T22:55:00Z', expires_at: '2026-10-05T22:55:00Z', bundle: true, entry_count: 2,
    }
    const output: ArtifactRecord = {
      ...input, id: 'output-bundle', direction: 'output', name: `whx_bundle_res_chat-1_${requestId}.zip`, size: 4096, created_at: '2026-09-05T22:56:00Z', entry_count: 4,
    }
    mocks.artifactEntries.mockResolvedValueOnce({ entries: [
      { path: 'turn.json', size: 42, dir: false },
      { path: 'artifacts/chart.png', size: 512, dir: false },
      { path: 'artifacts/report.md', size: 256, dir: false },
    ] })

    render(<ChatArtifactLibrary sessionId="ses_1" artifacts={[input, output]} />)

    expect(screen.getByText('Ficheiros e bundles')).toBeTruthy()
    expect(screen.getByText('whx_bundle_req_chat-1_req_20260905T225500_5555555555555555.zip')).toBeTruthy()
    expect(screen.getByText('whx_bundle_res_chat-1_req_20260905T225500_5555555555555555.zip')).toBeTruthy()
    const chartRow = await screen.findByTitle('Pré-visualizar artifacts/chart.png')
    expect(chartRow.textContent).toContain('chart.png')
    expect(screen.getByTitle('Descarregar artifacts/chart.png')).toBeTruthy()
    expect(screen.getByText('report.md')).toBeTruthy()
    expect(screen.queryByText('turn.json')).toBeNull()
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toContain('artifacts%2Fchart.png'))
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

    render(<ReturnedArtifactGallery sessionId="ses_1" artifacts={[bundle]} requestId={requestId} />)

    expect(await screen.findByText('Artefactos devolvidos')).toBeTruthy()
    expect(screen.getByText('Resultados')).toBeTruthy()
    expect(screen.getByText('Pré-visualização')).toBeTruthy()
    expect(screen.getByText('report.md')).toBeTruthy()
    expect(screen.getByText('Imagem gerada')).toBeTruthy()
    expect(mocks.artifactPresentation).toHaveBeenCalledWith('ses_1', 'response-artifacts')
    expect(document.querySelector('img')?.getAttribute('src')).toContain('artifacts%2Fpreview.png')
  })

})
