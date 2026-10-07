import { props } from '../fixtures'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import '../setup'
it('lets users manually reorder chat tabs by drag and keyboard', () => {
    const view = props()
    render(view.element)
    const primary = screen.getByRole('tab', { name: 'Principal' })
    const parallel = screen.getByRole('tab', { name: 'Paralelo' })
    const source = primary.closest('.chat-tab-group') as HTMLDivElement
    const target = parallel.closest('.chat-tab-group') as HTMLDivElement
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none', dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) || '',
    }
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragEnter(target, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(view.onReorderChat).toHaveBeenCalledWith('chat-1', 'chat-2')

    view.onReorderChat.mockClear()
    fireEvent.keyDown(primary, { key: 'ArrowRight', altKey: true })
    expect(view.onReorderChat).toHaveBeenCalledWith('chat-1', 'chat-2')
  })
