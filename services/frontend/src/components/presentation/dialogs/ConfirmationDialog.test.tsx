import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ConfirmationDialog } from './ConfirmationDialog'
it('contains focus, restores it, and blocks duplicate decisions while busy', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const save = vi.fn(), cancel = vi.fn()
  const props = { title: 'Guardar?', description: 'Há alterações.', onCancel: cancel, actions: [{ label: 'Cancelar', run: cancel }, { label: 'Guardar', tone: 'primary' as const, run: save }] }
  const view = render(<ConfirmationDialog {...props}/>)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Guardar' }))
  view.rerender(<ConfirmationDialog {...props} busy error="Falha de gravação"/>)
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(save).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toBe('Falha de gravação')
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove()
})
