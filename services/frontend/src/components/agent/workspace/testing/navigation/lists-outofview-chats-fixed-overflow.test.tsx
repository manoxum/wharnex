import { props } from '../fixtures'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import '../setup'
it('lists out-of-view chats in a fixed overflow menu and keeps reorder/save/archive actions', async () => {
    const view = props()
    const save = vi.fn(async () => undefined)
    const archive = vi.fn(async () => undefined)
    const chats = [
      { id: 'chat-1', title: 'Principal', sessionId: 'ses-agent', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
      { id: 'chat-2', title: 'Paralelo', sessionId: 'ses-parallel', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z' },
      { id: 'chat-3', title: 'Terceiro', sessionId: 'ses-third', createdAt: '2026-09-04T08:00:00.000Z', updatedAt: '2026-09-04T08:00:00.000Z' },
    ]
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 32, x: left, y: 0, width: right - left, height: 32, toJSON: () => ({}) } as DOMRect)
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('agent-workspace')) return rect(0, 1_200)
      if (this.getAttribute('aria-label') === 'Conversas abertas') return rect(0, 160)
      if (this.dataset.chatId === 'chat-1') return rect(0, 80)
      if (this.dataset.chatId === 'chat-2') return rect(80, 160)
      if (this.dataset.chatId === 'chat-3') return rect(160, 240)
      return rect(0, 40)
    })
    render(<view.Harness chatProps={{ chats, onSaveChat: save, onArchiveChat: archive }} />)

    const overflow = await screen.findByRole('button', { name: 'Chats fora da área visível, 1' })
    fireEvent.click(overflow)
    const menu = screen.getByRole('menu', { name: 'Chats não visíveis' })
    expect(within(menu).getByRole('menuitem', { name: 'Abrir chat Terceiro' })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: 'Guardar chat Terceiro' }))
    expect(save).toHaveBeenCalledWith('chat-3')
    fireEvent.click(within(menu).getByRole('button', { name: 'Fechar e arquivar chat Terceiro' }))
    expect(archive).toHaveBeenCalledWith('chat-3')

    const data = new Map<string, string>()
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) || '' }
    const hiddenRow = within(menu).getByRole('menuitem', { name: 'Abrir chat Terceiro' }).closest('.chat-overflow-row') as HTMLDivElement
    const visibleTarget = screen.getByRole('tab', { name: 'Principal' }).closest('.chat-tab-group') as HTMLDivElement
    fireEvent.dragStart(hiddenRow, { dataTransfer })
    fireEvent.dragEnter(visibleTarget, { dataTransfer })
    fireEvent.dragOver(visibleTarget, { dataTransfer })
    fireEvent.drop(visibleTarget, { dataTransfer })
    expect(view.onReorderChat).toHaveBeenCalledWith('chat-3', 'chat-1')
    geometry.mockRestore()
  })
