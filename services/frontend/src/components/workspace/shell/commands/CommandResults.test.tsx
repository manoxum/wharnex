import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'
it('bounds initial results and makes every remaining file available on demand', () => {
  const run = vi.fn()
  const commands = Array.from({ length: 130 }, (_, index) => ({ id: `file-${index}`, label: `file-${index}.ts`, description: `src/file-${index}.ts`, group: 'Ficheiros', icon: 'file' as const, run }))
  render(<CommandPalette commands={commands} onClose={vi.fn()}/>)
  expect(screen.getAllByRole('option')).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais resultados (100 de 130)' }))
  expect(screen.getAllByRole('option')).toHaveLength(130)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'file-129' } })
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(run).toHaveBeenCalledOnce()
})
it('reports a file loading failure without blocking real commands and retains retry', () => {
  const retry = vi.fn()
  render(<CommandPalette commands={[]} onClose={vi.fn()} loading error="Não foi possível ler o projeto" onRetry={retry}/>)
  expect(screen.getByRole('status').textContent).toContain('ficheiros')
  expect(screen.queryByText('Nenhum comando encontrado')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(retry).toHaveBeenCalledOnce()
})
