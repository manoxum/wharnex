import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIError, request } from './apiRequest'

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
})
