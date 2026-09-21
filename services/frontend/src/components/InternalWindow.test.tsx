import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTERNAL_WINDOW_DOCK_ID } from '../lib/internalWindow'
import { InternalWindow } from './InternalWindow'

afterEach(() => document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.remove())

describe('InternalWindow', () => {
  it('keeps the workspace interactive and moves minimized windows to the shared dock', () => {
    const close = vi.fn()
    render(<InternalWindow title="Pré-visualização" onClose={close} layerClassName="example-layer">
      <section role="dialog" aria-modal="false" aria-label="Pré-visualização"><label>Rascunho<input aria-label="Rascunho" defaultValue="inicial"/></label></section>
    </InternalWindow>)

    const dialog = screen.getByRole('dialog', { name: 'Pré-visualização' })
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    expect(document.querySelector('.internal-window-layer')?.className).toContain('example-layer')
    const draft = screen.getByRole('textbox', { name: 'Rascunho' }) as HTMLInputElement
    fireEvent.change(draft, { target: { value: 'preservado' } })

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar Pré-visualização' }))
    expect(screen.queryByRole('dialog', { name: 'Pré-visualização' })).toBeNull()
    expect(document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.textContent).toContain('Pré-visualização')

    fireEvent.click(screen.getByTitle('Restaurar Pré-visualização'))
    expect(screen.getByRole('dialog', { name: 'Pré-visualização' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Rascunho' }) as HTMLInputElement).value).toBe('preservado')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Pré-visualização' }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps close disabled while an operation cannot safely be dismissed', () => {
    render(<InternalWindow title="Operação Git" onClose={vi.fn()} closeDisabled>
      <section role="dialog" aria-modal="false" aria-label="Operação Git">A processar</section>
    </InternalWindow>)
    const close = screen.getByRole('button', { name: 'Fechar Operação Git' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
  })
})
