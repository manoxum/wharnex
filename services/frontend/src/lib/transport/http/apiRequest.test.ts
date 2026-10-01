import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIError, invalidatePendingReads, request } from './apiRequest'

function reply(status: number, body: unknown, etag?: string) {
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers: etag ? { ETag: etag } : {} })
}

afterEach(() => vi.unstubAllGlobals())

describe('request', () => {
  it('reuses the previous snapshot object when the engine answers 304', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(200, { files: [{ path: 'a' }] }, '"v1"'))
      .mockResolvedValueOnce(reply(304, null, '"v1"'))
    vi.stubGlobal('fetch', fetchMock)
    const first = await request<{ files: unknown[] }>('/api/sessions/s-reuse/files')
    const second = await request<{ files: unknown[] }>('/api/sessions/s-reuse/files')
    expect(second).toBe(first)
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('"v1"')
  })

  it('delivers a changed snapshot and never sends validators on writes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(200, { n: 1 }, '"v1"'))
      .mockResolvedValueOnce(reply(200, { n: 2 }, '"v2"'))
      .mockResolvedValueOnce(reply(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await request('/api/chat-agent/tasks')
    expect(await request('/api/chat-agent/tasks')).toEqual({ n: 2 })
    await request('/api/chat-agent/tasks', { method: 'POST', body: '{}' })
    expect(fetchMock.mock.calls[2][1].headers['If-None-Match']).toBeUndefined()
  })

  it('keeps surfacing engine errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, { error: { message: 'session not found' } })))
    await expect(request('/api/sessions/missing')).rejects.toBeInstanceOf(APIError)
  })

  it('coalesces simultaneous reads woken by the same backend event', async () => {
    let finish!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => { finish = resolve })
    const fetchMock = vi.fn().mockReturnValueOnce(firstResponse).mockResolvedValueOnce(reply(200, { version: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = request('/api/sessions/s-shared/git/overview')
    const second = request('/api/sessions/s-shared/git/overview')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    finish(reply(200, { version: 1 }))
    expect(await first).toEqual({ version: 1 })
    expect(await second).toEqual({ version: 1 })
    await request('/api/sessions/s-shared/git/overview')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a pre-change read after invalidation', async () => {
    let finishOld!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => { finishOld = resolve })
    const fetchMock = vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValueOnce(reply(200, { version: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    const path = '/api/sessions/s-refresh/git/overview'
    const old = request(path)
    invalidatePendingReads('/api/sessions/s-refresh/git/')
    const fresh = request(path)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    finishOld(reply(200, { version: 1 }))
    expect(await old).toEqual({ version: 1 })
    expect(await fresh).toEqual({ version: 2 })
  })

  it('does not let a late pre-change response replace the current ETag', async () => {
    let finishOld!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => { finishOld = resolve })
    const fetchMock = vi.fn()
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(reply(200, { version: 2 }, '"current"'))
      .mockResolvedValueOnce(reply(304, null, '"current"'))
    vi.stubGlobal('fetch', fetchMock)
    const path = '/api/sessions/s-late/git/overview'
    const old = request(path)
    invalidatePendingReads('/api/sessions/s-late/git/')
    const fresh = await request(path)
    finishOld(reply(200, { version: 1 }, '"old"'))
    await old
    expect(await request(path)).toBe(fresh)
    expect(fetchMock.mock.calls[2][1].headers['If-None-Match']).toBe('"current"')
  })
})
