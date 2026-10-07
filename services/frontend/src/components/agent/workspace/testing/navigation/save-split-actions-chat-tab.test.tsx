import { props } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import '../setup'
it('puts save and split actions on the chat tab context menu', () => {
    const view = props()
    const onSaveChat = vi.fn(async () => undefined)
    const onSplitChat = vi.fn()
    render(<view.Harness chatProps={{ onSaveChat }} workspaceProps={{ onSplitChat }} />)

    fireEvent.contextMenu(screen.getByRole('tab', { name: /^Principal/ }))
    expect(screen.getByRole('menu', { name: 'Ações da tab de chat' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Guardar em standby/ }))
    expect(onSaveChat.mock.calls).toEqual([['chat-1']])

    fireEvent.contextMenu(screen.getByRole('tab', { name: /^Principal/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dividir à direita/ }))
    expect(onSplitChat.mock.calls).toEqual([['chat-1', 'vertical']])

    fireEvent.contextMenu(screen.getByRole('tab', { name: /^Principal/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dividir abaixo/ }))
    expect(onSplitChat.mock.calls).toEqual([['chat-1', 'vertical'], ['chat-1', 'horizontal']])
  })
