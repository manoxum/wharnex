import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InternalWindow } from '../InternalWindow'
import { INTERNAL_WINDOW_DOCK_ID } from '../../../../lib/workspace/layout/internalWindow'
import { WindowPanelHeader } from './WindowPanelHeader'

afterEach(() => document.getElementById(INTERNAL_WINDOW_DOCK_ID)?.remove())
describe('shared window heading', () => {
  it('composes one close control with real maximize, minimize and restore actions', () => {
    const close = vi.fn()
    render(<InternalWindow title="Revisão" onClose={close} maximizable controlsInHeader closeLabel="Fechar revisão"><section role="dialog" aria-label="Revisão"><WindowPanelHeader title="Revisão" icon="git" onClose={close} closeLabel="Fechar revisão"/></section></InternalWindow>)
    const dialog = screen.getByRole('dialog', { name: 'Revisão' })
    const controls = within(dialog).getByRole('group', { name: 'Controlos da janela Revisão' })
    expect(controls.closest('header')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Fechar revisão' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Maximizar Revisão' }))
    expect(screen.getByRole('button', { name: 'Restaurar Revisão' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar Revisão' }))
    expect(screen.queryByRole('dialog', { name: 'Revisão' })).toBeNull()
    fireEvent.click(screen.getByTitle('Restaurar Revisão'))
    expect(screen.getByRole('dialog', { name: 'Revisão' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar revisão' }))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
