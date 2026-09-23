import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('remote api', () => {
  it('claims pairing through the dedicated same-origin API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ paired: true, remote: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.claimPairing('pair-once')).resolves.toEqual({ paired: true, remote: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/pairing/claim', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ code: 'pair-once' }) }))
  })


  it('accepts an empty successful pairing-session response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.endPairing()).resolves.toBeUndefined()
  })

  it('controls a tunnel without any Desktop bridge dependency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ remote_input: { enabled: true, mode: 'tunnel', instances: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api.controlTunnel('primary', 'pause')
    expect(fetchMock).toHaveBeenCalledWith('/api/tunnel/control', expect.objectContaining({ method: 'POST', body: JSON.stringify({ instance_id: 'primary', action: 'pause' }) }))
  })
})
