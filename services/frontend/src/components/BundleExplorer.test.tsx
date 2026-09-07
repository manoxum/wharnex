import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord } from '../types'
import { BundleExchangeBar } from './BundleExplorer'

const mocks = vi.hoisted(() => ({ artifactEntries: vi.fn(async () => ({ entries: [{ path: 'turn.json', size: 42, dir: false }] })) }))
vi.mock('../lib/api', () => ({ api: {
  artifactEntries: mocks.artifactEntries,
  artifactURL: (_sessionId: string, artifactId: string) => `/artifact/${artifactId}`,
  artifactEntryURL: (_sessionId: string, artifactId: string, path: string) => `/artifact/${artifactId}/entry?path=${encodeURIComponent(path)}`,
} }))

afterEach(() => { cleanup(); mocks.artifactEntries.mockClear() })

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
    expect(screen.getByTitle('Abrir galeria completa').textContent).toContain('1')
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

    fireEvent.click(screen.getByTitle('Abrir galeria completa'))
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

})
