import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import type { Session } from '../../../types'
import { DockerServicesPanel } from './DockerServicesPanel'

const session = { id: 'ses_docker', project_path: '/workspace/project' } as Session

const overview = {
  compose_projects: [{ name: 'project', container_count: 1, running_count: 1, error_count: 0, stopped_count: 0, redeploy_available: true, config_files: ['/workspace/project/compose.yml'], services: [{ name: 'web', container_count: 1, running_count: 1, error_count: 0 }, { name: 'worker', container_count: 0, running_count: 0, error_count: 0 }] }],
  containers: [{ id: 'abc123', name: 'web', image: 'example/web:latest', state: 'running', condition: 'running', status: 'Up 2 minutes', ports: '0.0.0.0:8080->8080/tcp', networks: 'project_default', compose_project: 'project', compose_service: 'web' }],
  images: [{ id: 'sha256:123', repository: 'example/web', tag: 'latest', size: '150MB', created_since: '2 days ago', in_use: true, container_count: 1 }],
  volumes: [{ name: 'project_data', driver: 'local', scope: 'local', mountpoint: '/var/lib/docker/volumes/project_data/_data', in_use: false, container_count: 0 }],
  networks: [{ id: 'net123', name: 'project_default', driver: 'bridge', scope: 'local', internal: false, in_use: true, container_count: 1 }],
  refreshed_at: '2026-09-20T23:00:00Z',
}

function sectionButton(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^${name}\\b`) })
}

function openSection(name: string) {
  const button = sectionButton(name)
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
  return button
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.removeItem('whx.docker.font-scale')
  window.localStorage.removeItem('whx.docker.expansion-state')
})

describe('DockerServicesPanel', () => {
  it('starts resource branches collapsed, remembers expansion and delegates shells to the Host terminal', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    vi.spyOn(api, 'dockerContainerLogs').mockResolvedValue({ container_id: 'abc123', tail: 300, content: 'server ready' })
    const onRunInTerminal = vi.fn()

    const first = render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()} onRunInTerminal={onRunInTerminal}/>)
    await screen.findByLabelText('Recursos Docker')
    await screen.findByRole('toolbar', { name: 'Ações de web' })

    expect(sectionButton('Compose').getAttribute('aria-expanded')).toBe('false')
    expect(sectionButton('Images').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('project_data')).toBeNull()

    openSection('Compose')
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Compose project' }))
    expect((await screen.findAllByText('web')).length).toBeGreaterThan(0)
    expect(screen.queryByText('compose.yml')).toBeNull()
    expect(screen.queryByLabelText('Serviço web: Ativo')).toBeNull()
    expect(screen.queryByLabelText('Serviço worker: Sem container')).toBeNull()

    openSection('Volumes')
    expect(await screen.findByText('project_data')).toBeTruthy()
    await waitFor(() => expect(window.localStorage.getItem('whx.docker.expansion-state') || '').toContain('"volumes":true'))

    const toolbar = screen.getByRole('toolbar', { name: 'Ações de web' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Terminal' }))
    expect(onRunInTerminal).toHaveBeenCalledWith({ command: "docker exec -it 'abc123' sh", cwd: '.', label: 'Docker · web' })

    first.unmount()
    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()}/>)
    await screen.findByLabelText('Recursos Docker')
    expect(sectionButton('Compose').getAttribute('aria-expanded')).toBe('true')
    expect(sectionButton('Volumes').getAttribute('aria-expanded')).toBe('true')
    expect((await screen.findByRole('button', { name: 'Recolher Compose project' })).getAttribute('aria-expanded')).toBe('true')
  })

  it('confirms Compose redeploy, Compose Down and deletion of an unused volume', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    const redeploy = vi.spyOn(api, 'dockerComposeRedeploy').mockResolvedValue({ status: 'ok', project: 'project' })
    const down = vi.spyOn(api, 'dockerComposeDown').mockResolvedValue({ status: 'ok', project: 'project' })
    const remove = vi.spyOn(api, 'dockerResourceRemove').mockResolvedValue({ status: 'ok', kind: 'volume', name: 'project_data' })

    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()}/>)
    await screen.findByLabelText('Recursos Docker')
    openSection('Compose')

    fireEvent.click(await screen.findByRole('button', { name: 'Redeploy Compose project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fazer redeploy' }))
    await waitFor(() => expect(redeploy).toHaveBeenCalledWith('ses_docker', 'project'))

    fireEvent.click(screen.getByRole('button', { name: 'Docker Compose Down project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Executar Compose Down' }))
    await waitFor(() => expect(down).toHaveBeenCalledWith('ses_docker', 'project'))

    openSection('Volumes')
    await screen.findByText('project_data')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar volume project_data' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar volume' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('ses_docker', 'volume', 'project_data'))
  })

  it('renders semantic Docker logs and filters error or warning lines', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    vi.spyOn(api, 'dockerContainerLogs').mockResolvedValue({
      container_id: 'abc123',
      tail: 300,
      content: [
        '2026-09-21T00:00:01.000000000Z server ready and listening',
        '2026-09-21T00:00:02.000000000Z WARN retrying connection after timeout',
        '2026-09-21T00:00:03.000000000Z ERROR failed to connect to database',
        '2026-09-21T00:00:04.000000000Z request completed',
      ].join('\n'),
    })

    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()}/>)
    const toolbar = await screen.findByRole('toolbar', { name: 'Ações de web' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Logs' }))

    const errorMessage = await screen.findByText('ERROR failed to connect to database')
    expect(errorMessage.parentElement?.getAttribute('class') || '').toContain('level-error')
    const warningMessage = screen.getByText('WARN retrying connection after timeout')
    expect(warningMessage.parentElement?.getAttribute('class') || '').toContain('level-warning')
    expect(screen.getByRole('button', { name: 'Erros 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Avisos 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Erros 1' }))
    expect(screen.getByText('ERROR failed to connect to database')).toBeTruthy()
    expect(screen.queryByText('WARN retrying connection after timeout')).toBeNull()
  })

  it('leaves text scaling to the shared workspace panel toolbar', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()}/>)
    await screen.findByLabelText('Serviços Docker')
    expect(screen.queryByRole('button', { name: 'Aumentar texto' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Diminuir texto' })).toBeNull()
  })

  it('filters all Docker resource groups and opens detailed resource views', async () => {
    vi.spyOn(api, 'dockerOverview').mockResolvedValue(overview)
    render(<DockerServicesPanel session={session} onClose={vi.fn()} onError={vi.fn()}/>)

    const tree = await screen.findByLabelText('Recursos Docker')
    fireEvent.change(screen.getByLabelText('Filtrar recursos Docker'), { target: { value: 'project_data' } })
    expect(await within(tree).findByRole('button', { name: 'Ver detalhes do volume project_data' })).toBeTruthy()
    expect(within(tree).queryByRole('button', { name: 'Ver detalhes do container web' })).toBeNull()
    expect(screen.getByText('1 resultado')).toBeTruthy()

    fireEvent.click(within(tree).getByRole('button', { name: 'Ver detalhes do volume project_data' }))
    expect(await screen.findByText('/var/lib/docker/volumes/project_data/_data')).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Ações do volume project_data' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }))
    fireEvent.change(screen.getByLabelText('Filtrar recursos Docker'), { target: { value: 'compose.yml' } })
    expect(await within(tree).findByRole('button', { name: 'Recolher Compose project' })).toBeTruthy()
    expect(within(tree).queryByText('compose.yml')).toBeNull()
    expect(within(tree).queryByLabelText(/Serviço .*:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }))
    openSection('Images')
    fireEvent.click(within(tree).getByRole('button', { name: 'Ver detalhes da imagem example/web:latest' }))
    expect(await screen.findByText('Imagem Docker')).toBeTruthy()
    expect(screen.getByText('sha256:123')).toBeTruthy()

    openSection('Networks')
    fireEvent.click(within(tree).getByRole('button', { name: 'Ver detalhes da rede project_default' }))
    expect(await screen.findByText('Rede Docker')).toBeTruthy()
    expect(screen.getByText('Rede criada pelo utilizador/Compose')).toBeTruthy()
  })
})
