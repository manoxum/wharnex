import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bridge } from '../../chatgpt/surface/chatGPTDesktopPaneTestFixtures'
import { BrowserMonitor } from './BrowserMonitor'

class ResizeObserverStub { observe() {}; disconnect() {}; unobserve() {} }

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

it('lists every browser and follows a Worker in the independent window', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({
    ...state,
    agents: [
      { ...state.agents[0], id: 'supervisor-1', label: 'Supervisor 1', role: 'supervisor' },
      state.agents[1],
      { ...state.agents[1], id: 'ephemeral-cat_123', label: 'Worker efémero', task: { type: 'ORCHESTRATOR_PLAN', task_id: 'task-1' } as DesktopAgentRuntimeTask },
    ],
  })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)

  expect(await screen.findByText('3 instâncias')).toBeTruthy()
  expect(screen.getByLabelText('Legenda dos estados')).toBeTruthy()
  expect(screen.getByText('Na fila / a aguardar')).toBeTruthy()
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('supervisor-1', expect.any(Object)))
  fireEvent.click(screen.getByRole('button', { name: /Worker efémero/ }))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('ephemeral-cat_123', expect.any(Object)))
  expect(desktop.agents.releaseFromMonitor).toHaveBeenCalledWith('supervisor-1')
  expect(desktop.agents.openInteraction).not.toHaveBeenCalledWith('ephemeral-cat_123', expect.any(Object))
  expect(screen.getByTitle('ORCHESTRATOR PLAN · task-1')).toBeTruthy()
  act(() => fireEvent.click(screen.getByRole('button', { name: /Worker 2/ })))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-2', expect.any(Object)))
  expect(desktop.agents.snapshot).not.toHaveBeenCalled()
})

it('recolhe e expande lista e detalhes de forma independente', async () => {
  const desktop = bridge()
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  expect(await screen.findByText('2 instâncias')).toBeTruthy()
  const list = screen.getByLabelText('Instâncias')
  const details = screen.getByLabelText('Detalhes da instância')
  expect(within(screen.getByRole('banner')).queryByRole('button', { name: /lista|detalhes/ })).toBeNull()
  fireEvent.click(within(list).getByRole('button', { name: 'Recolher lista de instâncias' }))
  expect(list.isConnected).toBe(true)
  expect(within(list).queryByRole('button', { name: /Worker 1/ })).toBeNull()
  expect(within(list).getByRole('button', { name: 'Expandir lista de instâncias' }).getAttribute('aria-expanded')).toBe('false')
  expect(details.isConnected).toBe(true)
  expect(screen.getByLabelText('Navegador da instância')).toBeTruthy()
  fireEvent.click(within(details).getByRole('button', { name: 'Recolher painel de detalhes' }))
  expect(details.isConnected).toBe(true)
  expect(within(details).queryByText('Tarefa')).toBeNull()
  expect(within(details).getByRole('button', { name: 'Expandir painel de detalhes' }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByLabelText('Navegador da instância')).toBeTruthy()
  fireEvent.click(within(list).getByRole('button', { name: 'Expandir lista de instâncias' }))
  expect(within(list).getByRole('button', { name: /Worker 1/ })).toBeTruthy()
  expect(within(details).queryByText('Tarefa')).toBeNull()
  fireEvent.click(within(details).getByRole('button', { name: 'Expandir painel de detalhes' }))
  expect(within(details).getByText('Tarefa')).toBeTruthy()
})

it('presents the real browser even when its current page is blank', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({
    ...state, agents: [{ ...state.agents[0], browser: { ...state.agents[0].browser, url: '', title: '' } }],
  })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-1', expect.any(Object)))
  expect(screen.getByLabelText('Navegador real de Worker 1')).toBeTruthy()
  expect(desktop.agents.openInteraction).not.toHaveBeenCalled()
  expect(desktop.agents.snapshot).not.toHaveBeenCalled()
})

it('shows the instance the tray asked for and manages the instance policies', async () => {
  const desktop = bridge()
  const state = await desktop.agents.state()
  vi.mocked(desktop.agents.state).mockResolvedValue({
    ...state, configured_supervisors: 2, configured_workers: 2, worker_pause: { paused: false, paused_until: '' },
    limits: { min_supervisors: 1, max_supervisors: 6, min_workers: 1, max_workers: 6 },
    policies: { auto_scale: false, auto_scale_max_supervisors: 6, auto_scale_max_workers: 3, keep_flowing_global: false, keep_flowing_workers: [], workers_suspended: false, workers_suspended_until: '', rate_limit_cooldown_minutes: 7.5, auto_scaled_supervisors: 0, auto_scaled_workers: 0 },
  })
  let select: (selection: { agentId: string }) => void = () => undefined
  vi.mocked(desktop.agents.onMonitorSelect).mockImplementation((callback) => { select = callback; return () => undefined })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-1', expect.any(Object)))
  act(() => select({ agentId: 'worker-2' }))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-2', expect.any(Object)))
  vi.mocked(desktop.agents.setPolicies).mockResolvedValue(await desktop.agents.state())
  vi.mocked(desktop.agents.releaseFromMonitor).mockClear()
  fireEvent.click(screen.getByRole('button', { name: /Políticas/ }))
  const policies = screen.getByRole('complementary', { name: 'Políticas das instâncias' })
  // The policies sit beside the real browser, which stays presented.
  expect(screen.getByLabelText('Navegador da instância')).toBeTruthy()
  expect(desktop.agents.releaseFromMonitor).not.toHaveBeenCalled()
  fireEvent.click(within(policies).getByRole('switch', { name: 'Auto scale' }))
  expect(desktop.agents.setPolicies).toHaveBeenCalledWith({ auto_scale: true })
  fireEvent.click(within(policies).getByRole('button', { name: 'Fechar políticas' }))
  expect(screen.queryByRole('complementary', { name: 'Políticas das instâncias' })).toBeNull()
})
