import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AttentionPopover } from './AttentionPopover'
import type { AttentionItem } from '../lib/attentionCenter'

const item: AttentionItem = {
  id: 'chat-1:blocked', chatId: 'chat-1', chatTitle: 'Principal', title: 'Atenção', detail: 'Precisa de revisão.', tone: 'warning', target: 'plan',
}

describe('AttentionPopover', () => {
  it('dismisses on Escape and outside pointer presses without treating the bell trigger as outside', () => {
    const onClose = vi.fn()
    const view = render(<><button data-attention-trigger="true">Bell</button><AttentionPopover items={[item]} activeChatId="chat-1" busy={false} onOpen={async () => undefined} onAction={async () => undefined} onOpenAll={vi.fn()} onClose={onClose}/><button onPointerDown={(event) => event.stopPropagation()}>Outside</button></>)
    const outside = screen.getByRole('button', { name: 'Outside' })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Bell' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(outside)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.focusIn(outside)
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent(window, new Event('blur'))
    expect(onClose).toHaveBeenCalledTimes(3)

    view.rerender(<AttentionPopover items={[item]} activeChatId="chat-1" busy={false} onOpen={async () => undefined} onAction={async () => undefined} onOpenAll={vi.fn()} onClose={onClose}/>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(4)
  })
})
