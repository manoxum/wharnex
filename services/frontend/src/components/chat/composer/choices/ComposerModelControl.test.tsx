import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerModelControl } from './ComposerModelControl'

const bridge = vi.hoisted(() => ({ getChatGPTModels: vi.fn(), setChatGPTModel: vi.fn() }))
vi.mock('../../../../lib/desktop/bridge/desktop', () => ({ desktopBridge: () => ({ chatgpt: bridge }) }))
const inventory = { ok: true, current: 'discovered-a', options: [
  { id: 'discovered-a', label: 'Modelo descoberto A', disabled: false },
  { id: 'discovered-b', label: 'Modelo descoberto B', disabled: false },
  { id: 'unavailable', label: 'Indisponível na conta', disabled: true },
] }

describe('chat-owned model choice', () => {
  beforeEach(() => { vi.resetAllMocks(); bridge.getChatGPTModels.mockResolvedValue(inventory) })
  afterEach(cleanup)

  it('only inspects on a human gesture and offers the models returned by this chat scraper', async () => {
    render(<ComposerModelControl workspaceChatId="chat-a" />)
    expect(bridge.getChatGPTModels).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Modelo do ChatGPT' }))
    await screen.findByRole('listbox', { name: 'Modelos disponíveis neste chat' })
    expect(bridge.getChatGPTModels).toHaveBeenCalledWith({ workspaceChatId: 'chat-a' })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(inventory.options.map((option) => option.label))
    expect((screen.getByRole('option', { name: 'Indisponível na conta' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the confirmed model until the owned remote control confirms the selection', async () => {
    let finish!: (value: typeof inventory) => void
    bridge.setChatGPTModel.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(<ComposerModelControl workspaceChatId="chat-a" />)
    const trigger = screen.getByRole('button', { name: 'Modelo do ChatGPT' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('option', { name: 'Modelo descoberto B' }))
    expect(bridge.setChatGPTModel).toHaveBeenCalledWith({ workspaceChatId: 'chat-a', model: 'discovered-b' })
    expect(trigger.textContent).toContain('Modelo descoberto A')
    finish({ ...inventory, current: 'discovered-b' })
    await waitFor(() => expect(trigger.textContent).toContain('Modelo descoberto B'))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('does not invent options when discovery needs attention', async () => {
    bridge.getChatGPTModels.mockResolvedValue({ ok: false, current: '', options: [], detail: 'Controlo ambíguo' })
    render(<ComposerModelControl workspaceChatId="chat-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Modelo do ChatGPT' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Controlo ambíguo')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(bridge.setChatGPTModel).not.toHaveBeenCalled()
  })

  it('discards late discovery from a previous chat', async () => {
    let finish!: (value: typeof inventory) => void
    bridge.getChatGPTModels.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<ComposerModelControl workspaceChatId="chat-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Modelo do ChatGPT' }))
    view.rerender(<ComposerModelControl workspaceChatId="chat-b" />)
    finish(inventory)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(screen.getByRole('button', { name: 'Modelo do ChatGPT' }).textContent).toBe('Modelo')
    fireEvent.click(screen.getByRole('button', { name: 'Modelo do ChatGPT' }))
    await screen.findByRole('listbox')
    expect(bridge.getChatGPTModels).toHaveBeenLastCalledWith({ workspaceChatId: 'chat-b' })
  })

  it('does not reuse stale options after a later structural discovery fails', async () => {
    render(<ComposerModelControl workspaceChatId="chat-a" />)
    const trigger = screen.getByRole('button', { name: 'Modelo do ChatGPT' })
    fireEvent.click(trigger)
    await screen.findByRole('listbox')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    bridge.getChatGPTModels.mockResolvedValue({ ok: false, current: '', options: [], detail: 'Controlo mudou' })
    fireEvent.click(trigger)
    await screen.findByRole('alert')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(trigger.textContent).toContain('Modelo descoberto A')
    expect(bridge.setChatGPTModel).not.toHaveBeenCalled()
  })

  it('retains confirmed state on selection failure and supports keyboard dismissal', async () => {
    bridge.setChatGPTModel.mockRejectedValue(new Error('Request ativa'))
    render(<ComposerModelControl workspaceChatId="chat-a" />)
    const trigger = screen.getByRole('button', { name: 'Modelo do ChatGPT' })
    fireEvent.click(trigger)
    const first = await screen.findByRole('option', { name: 'Modelo descoberto A' })
    fireEvent.keyDown(trigger, { key: 'Home' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Modelo descoberto B' }))
    fireEvent.click(document.activeElement!)
    await screen.findByRole('alert')
    expect(trigger.textContent).toContain('Modelo descoberto A')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('never opens discovery while disabled', () => {
    render(<ComposerModelControl workspaceChatId="chat-a" disabled />)
    const trigger = screen.getByRole('button', { name: 'Modelo do ChatGPT' }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    fireEvent.click(trigger)
    expect(bridge.getChatGPTModels).not.toHaveBeenCalled()
  })

  it('passes only this chat binding to discovery and selection for a non-resident supervisor', async () => {
    const url = 'https://chatgpt.com/c/owned-conversation'
    bridge.setChatGPTModel.mockResolvedValue({ ...inventory, current: 'discovered-b' })
    render(<ComposerModelControl workspaceChatId="chat-a" url={url} />)
    fireEvent.click(screen.getByRole('button', { name: 'Modelo do ChatGPT' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Modelo descoberto B' }))
    await waitFor(() => expect(bridge.setChatGPTModel).toHaveBeenCalledWith({ workspaceChatId: 'chat-a', url, model: 'discovered-b' }))
    expect(bridge.getChatGPTModels).toHaveBeenCalledWith({ workspaceChatId: 'chat-a', url })
  })

  it('opens from ArrowUp on the last enabled choice and handles Home, End and Escape', async () => {
    render(<ComposerModelControl workspaceChatId="chat-a" />)
    const trigger = screen.getByRole('button', { name: 'Modelo do ChatGPT' })
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    const last = await screen.findByRole('option', { name: 'Modelo descoberto B' })
    await waitFor(() => expect(document.activeElement).toBe(last))
    fireEvent.keyDown(last, { key: 'Home' })
    const first = screen.getByRole('option', { name: 'Modelo descoberto A' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'End' })
    expect(document.activeElement).toBe(last)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
