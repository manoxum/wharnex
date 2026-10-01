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

  it('creates new remote sessions with high effort by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'ses-1', effort_level: 'high' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api.createSession('/work/core', 'chat-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ project_path: '/work/core', execution_mode: 'protected', automation_mode: 'auto', effort_level: 'high', reasoning_effort: 'high', chat_id: 'chat-1' }) }))
  })

  it('queues a request for a Desktop-owned Supervisor', async () => {
    const payload = { request_id: 'req_remote123', workspace_chat_id: 'chat-1', bootstrap_text: 'Ship it', chat_title: 'Remote chat', attachments: [], project_files: [], tunnel_instance_ids: [], include_context: true }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ queued: true, task: { task_id: 'cat-1', type: 'BOT_WRITE', status: 'PENDING' } }), { status: 202, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api.remoteDispatch('ses-1', payload)
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/ses-1/remote-dispatch', expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) }))
  })

  it('loads durable Desktop project history instead of inferring projects from storage', async () => {
    const payload = { projects: [{ project_path: '/work/core', name: 'core', open: false }] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.projectHistory()).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/history', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('controls a tunnel without any Desktop bridge dependency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ remote_input: { enabled: true, mode: 'tunnel', instances: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api.controlTunnel('primary', 'pause')
    expect(fetchMock).toHaveBeenCalledWith('/api/tunnel/control', expect.objectContaining({ method: 'POST', body: JSON.stringify({ instance_id: 'primary', action: 'pause' }) }))
  })
})
