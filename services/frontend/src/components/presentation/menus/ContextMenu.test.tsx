import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ContextMenu } from './ContextMenu'
it('clamps to viewport and skips disabled actions during keyboard navigation', () => {
  const close = vi.fn(), run = vi.fn()
  render(<ContextMenu x={9999} y={9999} label="Menu" onClose={close} actions={[
    { id: 'a', label: 'Primeiro', run }, { id: 'b', label: 'Indisponível', disabled: true, run }, { id: 'c', label: 'Último', separator: true, run },
  ]}/>)
  const menu = screen.getByRole('menu')
  expect(Number.parseFloat(menu.style.left)).toBeLessThan(window.innerWidth)
  expect(Number.parseFloat(menu.style.top)).toBeLessThan(window.innerHeight)
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Primeiro' }))
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Último' }))
  fireEvent.keyDown(menu, { key: 'Escape' }); expect(close).toHaveBeenCalled()
  fireEvent.pointerDown(document.body); expect(close).toHaveBeenCalledTimes(1)
})
it('returns keyboard focus to its invoker when Escape dismisses the menu', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const view = render(<ContextMenu x={20} y={20} label="Menu de ficheiro" onClose={() => view.unmount()} actions={[{ id: 'a', label: 'Copiar', run: vi.fn() }]}/>)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})
