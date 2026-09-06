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
})
