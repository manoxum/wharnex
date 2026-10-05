import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserMonitorDetails } from './BrowserMonitorDetails'

const catalog = vi.hoisted(() => ({ managedArtifacts: vi.fn(async () => ({ artifacts: [] })) }))
vi.mock('../../../lib/transport/http/api', () => ({ api: catalog }))
afterEach(() => { cleanup(); catalog.managedArtifacts.mockClear() })

it('shows truthful manual-view details and keeps bundles as the final section', async () => {
  const agent = {
    id: 'link:workspace:chat-1', label: 'Revisão do plano', role: 'worker', status: 'idle', draining: false,
    chat_id: 'chat-1', project_id: '/work', error: '',
    browser: { available: true, web_contents_id: 0, url: 'https://chatgpt.com/c/review', title: 'Revisão do plano', loading: false },
  } as DesktopAgentRuntimeAgent
  const link = { key: 'workspace:chat-1', project_path: '/work', chat_id: 'chat-1', session_id: 'ses-1', title: 'Revisão do plano', url: 'https://chatgpt.com/c/review', kind: 'workspace' as const }
  render(<BrowserMonitorDetails agent={agent} link={link} expanded onToggle={() => undefined} onExplorerOpenChange={() => undefined} />)
  const details = screen.getByLabelText('Detalhes da instância')
  expect(within(details).getAllByText('Visualização manual').length).toBeGreaterThan(0)
  expect(within(details).getByText('Vista efêmera · sem tarefa')).toBeTruthy()
  expect(details.lastElementChild?.getAttribute('aria-label')).toBe('Bundles trocados')
  await screen.findByText('Nenhum bundle persistido para esta instância.')
})
