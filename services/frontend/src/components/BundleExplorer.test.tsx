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
      id: 'artifact_1', request_id: 'req_12345678', direction: 'input', kind: 'bundle', name: 'wharness-input.zip', content_type: 'application/zip',
      size: 2048, sha256: 'a'.repeat(64), created_at: '2026-09-05T22:00:00Z', expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1,
    }
    render(<BundleExchangeBar sessionId="ses_1" artifacts={[bundle]} />)
    expect(screen.getByText('wharness-input.zip')).toBeTruthy()
    expect(screen.getByText(/2.0 KB/)).toBeTruthy()
    fireEvent.click(screen.getByTitle('Explorar wharness-input.zip'))
    await waitFor(() => expect(mocks.artifactEntries).toHaveBeenCalledWith('ses_1', 'artifact_1'))
    expect(await screen.findByText('turn.json')).toBeTruthy()
    expect(screen.getByText('Bundle inteiro')).toBeTruthy()
  })
  it('ignores auxiliary ZIP artifacts even when they are technically inspectable bundles', () => {
    const base = { content_type: 'application/zip', size: 1024, sha256: 'c'.repeat(64), created_at: '2026-09-05T22:00:00Z', expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1 }
    const artifacts: ArtifactRecord[] = [
      { ...base, id: 'transport', request_id: 'req-main', direction: 'input', kind: 'bundle', name: 'request.zip' },
      { ...base, id: 'context', request_id: 'req-main', direction: 'input', kind: 'context', name: 'context.zip' },
      { ...base, id: 'attachment', request_id: 'req-main', direction: 'input', kind: 'attachment', name: 'attachment.zip' },
    ]

    render(<BundleExchangeBar sessionId="ses_1" artifacts={artifacts} />)
    expect(screen.getByText('request.zip')).toBeTruthy()
    expect(screen.queryByText('context.zip')).toBeNull()
    expect(screen.queryByText('attachment.zip')).toBeNull()
    expect(screen.getByTitle('Abrir galeria completa').textContent).toContain('1')
  })

  it('assigns a distinct visual category to every request/response bundle stage', async () => {
    const base = { kind: 'bundle', content_type: 'application/zip', size: 2048, sha256: 'b'.repeat(64), expires_at: '2026-10-05T22:00:00Z', bundle: true, entry_count: 1 }
    const artifacts: ArtifactRecord[] = [
      { ...base, id: 'main', request_id: 'req-main', direction: 'input', name: 'main.zip', created_at: '2026-09-05T18:00:00Z' },
      { ...base, id: 'repair', request_id: 'req-repair', direction: 'input', name: 'repair.zip', created_at: '2026-09-05T19:00:00Z' },
      { ...base, id: 'response', request_id: 'req-repair', direction: 'output', name: 'response.zip', created_at: '2026-09-05T20:00:00Z' },
      { ...base, id: 'summary-request', request_id: 'req-summary', direction: 'input', name: 'summary-request.zip', created_at: '2026-09-05T21:00:00Z' },
      { ...base, id: 'summary-response', request_id: 'req-summary', direction: 'output', name: 'summary-response.zip', created_at: '2026-09-05T22:00:00Z' },
    ]
    const requestLineages = {
      'req-main': { request_id: 'req-main', root_request_id: 'req-main', kind: 'standard' as const, created_at: '2026-09-05T18:00:00Z' },
      'req-repair': { request_id: 'req-repair', root_request_id: 'req-main', parent_request_id: 'req-main', kind: 'repair' as const, created_at: '2026-09-05T19:00:00Z' },
      'req-summary': { request_id: 'req-summary', root_request_id: 'req-main', parent_request_id: 'req-main', kind: 'knowledge_review' as const, created_at: '2026-09-05T21:00:00Z' },
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
