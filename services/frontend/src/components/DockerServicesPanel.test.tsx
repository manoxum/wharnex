import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Session } from '../types'
import { DockerServicesPanel } from './DockerServicesPanel'

const session = { id: 'ses_docker', project_path: '/workspace/project' } as Session

const overview = {
  compose_projects: [{ name: 'project', container_count: 1, running_count: 1, error_count: 0, stopped_count: 0 }],
  containers: [{ id: 'abc123', name: 'web', image: 'example/web:latest', state: 'running', condition: 'running', status: 'Up 2 minutes', ports: '0.0.0.0:8080->8080/tcp', networks: 'project_default', compose_project: 'project', compose_service: 'web' }],
  images: [{ id: 'sha256:123', repository: 'example/web', tag: 'latest', size: '150MB', created_since: '2 days ago', in_use: true, container_count: 1 }],
  volumes: [{ name: 'project_data', driver: 'local', scope: 'local', in_use: false, container_count: 0 }],
  networks: [{ id: 'net123', name: 'project_default', driver: 'bridge', scope: 'local', internal: false, in_use: true, container_count: 1 }],
  refreshed_at: '2026-09-20T23:00:00Z',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.removeItem('whx.docker.font-scale')
})

describe('DockerServicesPanel', () => {
  it('groups Compose services, reports usage and delegates shells to the Host terminal', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    vi.spyOn(api, 'dockerContainerLogs').mockResolvedValue({ container_id: 'abc123', tail: 300, content: 'server ready' })
    const onRunInTerminal = vi.fn()

    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()} onRunInTerminal={onRunInTerminal}/>)

    expect((await screen.findAllByText('project')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('web')).length).toBeGreaterThan(0)
    expect(screen.getByText('project_data')).toBeTruthy()
    expect(screen.getAllByText('Em uso · 1').length).toBeGreaterThan(0)
    expect(screen.getByText('Livre')).toBeTruthy()

    const toolbar = screen.getByRole('toolbar', { name: 'Ações de web' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Terminal' }))
    expect(onRunInTerminal).toHaveBeenCalledWith({ command: "docker exec -it 'abc123' sh", cwd: '.', label: 'Docker · web' })

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Logs' }))
    await waitFor(() => expect(screen.getByText('server ready')).toBeTruthy())
  })

  it('confirms Compose Down and deletion of an unused volume', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    const down = vi.spyOn(api, 'dockerComposeDown').mockResolvedValue({ status: 'ok', project: 'project' })
    const remove = vi.spyOn(api, 'dockerResourceRemove').mockResolvedValue({ status: 'ok', kind: 'volume', name: 'project_data' })

    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()}/>)
    await screen.findByText('project_data')

    fireEvent.click(screen.getByRole('button', { name: 'Docker Compose Down project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Executar Compose Down' }))
    await waitFor(() => expect(down).toHaveBeenCalledWith('ses_docker', 'project'))

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar volume project_data' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar volume' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('ses_docker', 'volume', 'project_data'))
  })

  it('lets the operator increase Docker text independently', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()}/>)
    const panel = await screen.findByLabelText('Serviços Docker')
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar texto' }))
    expect(panel.getAttribute('style') || '').toContain('--docker-user-scale: 1.25')
    expect(window.localStorage.getItem('whx.docker.font-scale')).toBe('1.25')
  })
})
