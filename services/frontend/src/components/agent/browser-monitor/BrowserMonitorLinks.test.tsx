import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bridge } from '../../chatgpt/surface/chatGPTDesktopPaneTestFixtures'
import { BrowserLinkViewport } from './BrowserLinkViewport'
import { BrowserMonitor } from './BrowserMonitor'
import { BrowserMonitorLinks } from './BrowserMonitorLinks'
import type { BrowserMonitorChat } from '../../../lib/transport/http/browser-monitor/catalog'

const catalog = vi.hoisted(() => ({ browserMonitorChats: vi.fn(), managedArtifacts: vi.fn(async () => ({ artifacts: [] })) }))
vi.mock('../../../lib/transport/http/api', () => ({ api: catalog }))

class ResizeObserverStub { observe() {}; disconnect() {} }
const chat: BrowserMonitorChat = { key: 'workspace:chat-1', project_path: '/work', chat_id: 'chat-1', title: 'Revisão do plano', url: 'https://chatgpt.com/c/review', kind: 'workspace' }
const task: BrowserMonitorChat = { key: 'task:task-1', project_path: '/work', chat_id: 'task-1', session_id: 'ses-1', title: 'Implementar módulo', url: 'https://chatgpt.com/c/task', kind: 'task' }

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub); catalog.browserMonitorChats.mockResolvedValue({ chats: [chat, task] }) })
afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals(); catalog.browserMonitorChats.mockReset() })

it('lists durable named chats from Supervisor and Worker sources and selects by chat', async () => {
  const selected = vi.fn()
  render(<BrowserMonitorLinks agents={[]} selectedKey="" onSelect={selected} />)
  expect(await screen.findByText('Revisão do plano')).toBeTruthy()
  expect(screen.getByText('Implementar módulo')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Implementar módulo/ }))
  expect(selected).toHaveBeenCalledWith(task)
})

it('presents a non-resident chat in its own view and releases and closes it', async () => {
  const desktop = bridge()
  window.wharnessDesktop = desktop
  const view = render(<BrowserLinkViewport chat={chat} suspended={false} />)
  await waitFor(() => expect(desktop.agents.presentLinkInMonitor).toHaveBeenCalledWith(chat.url, expect.any(Object)))
  view.rerender(<BrowserLinkViewport chat={chat} suspended />)
  await waitFor(() => expect(desktop.agents.releaseLinkInMonitor).toHaveBeenCalledWith(chat.url))
  view.unmount()
  await waitFor(() => expect(desktop.agents.closeLinkInMonitor).toHaveBeenCalledWith(chat.url))
})

it('honors a tray instance selection while a historical link is open', async () => {
  const desktop = bridge()
  let select: (value: { agentId: string }) => void = () => undefined
  vi.mocked(desktop.agents.onMonitorSelect).mockImplementation((callback) => { select = callback; return () => undefined })
  window.wharnessDesktop = desktop
  render(<BrowserMonitor />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Links GPT' }))
  fireEvent.click(await screen.findByRole('button', { name: /Revisão do plano/ }))
  await waitFor(() => expect(desktop.agents.presentLinkInMonitor).toHaveBeenCalledWith(chat.url, expect.any(Object)))
  act(() => select({ agentId: 'worker-2' }))
  await waitFor(() => expect(desktop.agents.presentInMonitor).toHaveBeenCalledWith('worker-2', expect.any(Object)))
  expect(desktop.agents.closeLinkInMonitor).toHaveBeenCalledWith(chat.url)
})
