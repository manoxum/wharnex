import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PanelOptions } from './PanelOptions'
it('uses the existing move/pin callbacks and closes each completed menu action', () => {
  const move = vi.fn(), maximize = vi.fn()
  render(<PanelOptions label="Git" scale={1} onScale={vi.fn()} side="left" onMove={move} onMaximize={maximize}/>)
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Opções do painel Git' }))
  open(); fireEvent.click(screen.getByRole('button', { name: 'Mover para a direita' }))
  expect(move).toHaveBeenCalledWith('right', false)
  expect(screen.queryByRole('dialog')).toBeNull()
  open(); fireEvent.click(screen.getByRole('button', { name: 'Fixar na barra' }))
  expect(move).toHaveBeenCalledWith('left', true)
  open(); fireEvent.click(screen.getByRole('button', { name: 'Maximizar painel' }))
  expect(maximize).toHaveBeenCalledOnce()
})
