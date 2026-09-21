import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
import { DockerServicesPanel } from './DockerServicesPanel'

const session = { id: 'ses_docker', project_path: '/workspace/project' } as Session

const overview = {
  containers: [{ id: 'abc123', name: 'web', image: 'example/web:latest', state: 'running', status: 'Up 2 minutes', ports: '0.0.0.0:8080->8080/tcp', networks: 'project_default' }],
  images: [{ id: 'sha256:123', repository: 'example/web', tag: 'latest', size: '150MB', created_since: '2 days ago' }],
  volumes: [{ name: 'project_data', driver: 'local', scope: 'local' }],
  networks: [{ id: 'net123', name: 'project_default', driver: 'bridge', scope: 'local', internal: false }],
  refreshed_at: '2026-09-20T23:00:00Z',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DockerServicesPanel', () => {
  it('lists Docker resources and delegates container shells to the human Host terminal', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    vi.spyOn(api, 'dockerContainerLogs').mockResolvedValue({ container_id: 'abc123', tail: 300, content: 'server ready' })
    const onRunInTerminal = vi.fn()

    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()} onRunInTerminal={onRunInTerminal}/>)

    expect((await screen.findAllByText('web')).length).toBeGreaterThan(0)
    expect(screen.getByText('project_data')).toBeTruthy()
    expect(screen.getAllByText('project_default').length).toBeGreaterThan(0)

    const toolbar = screen.getByRole('toolbar', { name: 'Ações de web' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Terminal' }))
    expect(onRunInTerminal).toHaveBeenCalledWith({ command: "docker exec -it 'abc123' sh", cwd: '.', label: 'Docker · web' })

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Logs' }))
    await waitFor(() => expect(screen.getByText('server ready')).toBeTruthy())
  })
})
